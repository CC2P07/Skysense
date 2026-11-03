from machine import Pin, ADC, I2C
import dht
import time
import network
import urequests
import ujson
from bmp280 import BMP280

# CONFIGURACAO DE PERFIS DE REDE E API
CONFIGURACAO = [
    {
        "nome": "Guilherme",
        "ssid": "FAMILIA @LMEIDA",  # Ajuste para o SSID correto da sua rede
        "senha": "Amor@7854",
        "api_url": "http://192.168.15.7:8000/api/clima",
        "cidade": "São Paulo",
        "estado": "SP"
    }
]

# Inicialização global da interface Wi-Fi para evitar reinstanciação excessiva
wifi = network.WLAN(network.STA_IF)

def conectar_wifi():
    wifi.active(True)
    
    for perfil in CONFIGURACAO:
        print(f"Tentando conectar em: {perfil['nome']} ({perfil['ssid']})...")
        
        if wifi.isconnected():
            wifi.disconnect()
            time.sleep(1)

        wifi.connect(perfil["ssid"], perfil["senha"])
    
        tentativas = 0
        while not wifi.isconnected() and tentativas < 15:
            print("Aguardando Wi-Fi...")
            time.sleep(1)
            tentativas += 1
            
        if wifi.isconnected():
            print(f"Sucesso! Conectado à rede de: {perfil['nome']}")
            print("IP da placa:", wifi.ifconfig()[0])
            return perfil 
            
    print("Aviso: Nenhuma rede conhecida foi encontrada!")
    return None

# CONFIGURACAO DOS SENSORES
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

# Conexão inicial
perfil_ativo = conectar_wifi()

while True:
    try:
        if not wifi.isconnected() or perfil_ativo is None:
            print("Wi-Fi desconectado. Tentando reconectar...")
            perfil_ativo = conectar_wifi()
            
        try:
            dht22.measure()
            temperatura = dht22.temperature()
            umidade = dht22.humidity()
        except Exception as e:
            print("Aviso: Falha na leitura do DHT22:", e)
            temperatura = None
            umidade = None

        try:
            luminosidade = ldr.read()
        except Exception:
            luminosidade = None

        try:
            gas_valor = gas.read()
        except Exception:
            gas_valor = None

        if sensor_bmp is not None:
            try:
                pressao = sensor_bmp.pressure
                altitude = 44330 * (1.0 - pow(pressao / 101325.0, 0.1903))
            except Exception:
                pressao = None
                altitude = None
        else:
            pressao = None
            altitude = None

        # Exibição local no console do Thonny
        print("---------------------------")
        print("Temperatura:", temperatura, "°C")
        print("Umidade:", umidade, "%")
        print("Pressao:", pressao, "Pa")
        print("Luminosidade:", luminosidade)
        print("Gas MQ-135:", gas_valor)

        # Montagem do payload e envio
        if perfil_ativo is not None:
            dados = {
                "usuario": perfil_ativo["nome"],
                "temperatura": temperatura,
                "umidade": umidade,
                "pressao": pressao,
                "altitude": altitude,
                "luminosidade": luminosidade,
                "gas": gas_valor,
                "cidade": perfil_ativo["cidade"],
                "estado": perfil_ativo["estado"]
            }
            
            payload_json = ujson.dumps(dados)
            print("Enviando dados para a API...")

            resposta = urequests.post(
                perfil_ativo["api_url"], 
                data=payload_json, 
                headers={"Content-Type": "application/json"}
            )
            
            print("Status HTTP:", resposta.status_code)
            print("Resposta:", resposta.text)
            resposta.close()
        else:
            print("Aviso: Sem conexão Wi-Fi ativa para envio.")

    except Exception as erro:
        print("Erro crítico no ciclo:", erro)

    time.sleep(60)
