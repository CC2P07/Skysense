from machine import Pin, ADC, I2C
import dht
import time
import network
import urequests
from bmp280 import BMP280

# ==================================
# CONFIGURACAO DE PERFIS DE REDE E API
# ==================================
CONFIGURACAO = [
    {
        "nome": "Guilherme",
        "ssid": "FAMILIA @LMEIDA",
        "senha": "Amor@7854",
        "api_url": "http://192.168.15.7:8000/api/clima",
        "cidade": "São Paulo",
        "estado": "SP"
    }
]

def conectar_wifi():
    modo_station = network.WLAN(network.STA_IF)
    modo_station.active(True)
    
    for perfil in CONFIGURACAO:
        print(f"Tentando conectar em: {perfil['nome']} ({perfil['ssid']})...")
        modo_station.connect(perfil["ssid"], perfil["senha"])
    
        tentativas = 0
        while not modo_station.isconnected() and tentativas < 10:
            time.sleep(1)
            tentativas += 1
            
        if modo_station.isconnected():
            print(f"Sucesso! Conectado à rede de: {perfil['nome']}")
            print("IP da placa:", modo_station.ifconfig()[0])
            return perfil 
            
    print("Aviso: Nenhuma rede conhecida foi encontrada!")
    return None

# ==================================
# CONFIGURACAO DOS SENSORES
# ==================================
dht22 = dht.DHT22(Pin(4))
ldr = ADC(Pin(35))
ldr.atten(ADC.ATTN_11DB)
gas = ADC(Pin(34))
gas.atten(ADC.ATTN_11DB)

i2c = I2C(0, scl=Pin(22), sda=Pin(21), freq=100000)

try:
    sensor_bmp = BMP280(i2c)
    print("BMP280 inicializado com sucesso!")
except Exception as e:
    sensor_bmp = None
    print("Aviso: BMP280 não detectado:", e)

print("Monitoramento SkySense iniciado!")

# Inicializa o perfil de conexão antes de entrar no loop principal
perfil_ativo = conectar_wifi()

while True:
    try:
        modo_station = network.WLAN(network.STA_IF)
        if not modo_station.isconnected() or perfil_ativo is None:
            print("Wi-Fi desconectado. Tentando reconectar...")
            perfil_ativo = conectar_wifi()
            
        # Leituras dos sensores físicos
        dht22.measure()
        temperatura = dht22.temperature()
        umidade = dht22.humidity()

        luminosidade = ldr.read()
        gas_valor = gas.read()

        if sensor_bmp is not None:
            pressao = sensor_bmp.pressure
        else:
            pressao = 0.0

        # Exibição local no console do Thonny
        print("---------------------------")
        print("Temperatura:", temperatura, "°C")
        print("Umidade:", umidade, "%")
        print("Pressao:", pressao, "Pa")
        print("Luminosidade:", luminosidade)
        print("Gas MQ-135:", gas_valor)

        # Montagem do payload unificado compatível com o schema do main.py[cite: 3, 6]
        if perfil_ativo:
            dados = {
                "usuario": perfil_ativo["nome"],
                "temperatura": temperatura,
                "umidade": umidade,
                "pressao": pressao,
                "luminosidade": luminosidade,
                "gas": gas_valor,
                "cidade": perfil_ativo["cidade"],
                "estado": perfil_ativo["estado"]
            }
            
            cabecalhos = {'Content-Type': 'application/json'}

            # Envio POST para a API do FastAPI[cite: 3, 6]
            resposta = urequests.post(
                perfil_ativo["api_url"], 
                json=dados, 
                headers=cabecalhos
            )
            
            print("Resposta da API (Status HTTP):", resposta.status_code)
            resposta.close()
        else:
            print("Aviso: Sem conexão Wi-Fi ativa para envio.")

    except Exception as erro:
        print("Erro crítico no ciclo:", erro)

    time.sleep(60)
