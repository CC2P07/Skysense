
from machine import Pin, ADC, I2C
import dht
import time
import network
import urequests
from bmp280 import BMP280

# LISTA DE PERFIS PARA CONEXÃO COM O ESP.
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

# CONEXÃO DE INTERNET. CONEXÃO BASEADA EM CONFIGURACAO, PARA CASO REALIZAR TESTES EM DIFERENTES LOCAIS. Retorna o perfil utilizado no final.
def conectar_wifi():
    modoStation = network.WLAN(network.STA_IF)
    modoStation.active(True)
    
    for perfil in CONFIGURACAO:
        print(f"Tentando conectar em: {perfil['nome']} ({perfil['ssid']})...")
        modoStation.connect(perfil["ssid"], perfil["senha"])
    
        tentativas = 0
        while not modoStation.isconnected() and tentativas < 10:
            time.sleep(1)
            tentativas += 1
            
        if modoStation.isconnected():
            print(f"Sucesso! Conectado à rede de: {perfil['nome']}")
            print("IP da placa:", modoStation.ifconfig()[0])
            return perfil 
            
    print("Aviso: Nenhuma rede conhecida foi encontrada!")
    return None

# Pinos
dht22 = dht.DHT22(Pin(4))

ldr = ADC(Pin(35))
ldr.atten(ADC.ATTN_11DB)

gas = ADC(Pin(34))
gas.atten(ADC.ATTN_11DB)

i2c = I2C(0, scl=Pin(22), sda=Pin(21), freq=100000)

# Sensores
bmp = BMP280(i2c)

print("Monitoramento iniciado!")

while True:
    try:
        modo_station = network.WLAN(network.STA_IF)
        if not modo_station.isconnected() or perfil_ativo is None:
            print("Wi-Fi desconectado. Tentando reconectar...")
            perfilAtivo = conectar_wifi()
            
        dht22.measure()
        temperatura = dht22.temperature()
        umidade = dht22.humidity()

        pressao = bmp.pressure

        luminosidade = ldr.read()
        gas_valor = gas.read()

        print("---------------------------")
        print("Temperatura:", temperatura, "C")
        print("Umidade:", umidade, "%")
        print("Pressao:", pressao, "Pa")
        print("LDR:", luminosidade)
        print("Gas MQ-135:", gas_valor)

        if perfilAtivo:
            dadosArmazenados = {
                "temperatura": temperatura,
                "umidade": umidade,
                "pressao": pressao,
                "luminosidade": luminosidade,
                "gas": gas_valor,
                "cidade": perfilAtivo["cidade"],
                "estado": perfilAtivo["estado"]
            }
    # Para envio facilitado aos dados Pydantic em main.py
    cabecalhos = {'Content-Type': 'application/json'}

        # Realizando teste inicial, mas a ideia é de que tudo gere uma resposta, para facilitar a identificação dos problemas.
        resposta = urequests.post(perfilAtivo["api_url"], json=dadosArmazenados, headers=cabecalhos)
        print("Dados enviados com sucesso! Status HTTP:", resposta.status_code)
        resposta.close() # Fecha a conexão para liberar memória RAM da placa

    except Exception as erro:
        print("Erro ao coletar ou enviar dados:", erro)

    # Intervalo de 60 segundos entre as coletas
    time.sleep(60)
