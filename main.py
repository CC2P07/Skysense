
from machine import Pin, ADC
import dht
import time
import network
import ujson
import urequests

# ==================================
# CONFIGURACAO DA REDE E DA API
# ==================================

WIFI_SSID = "FAMILIA @LMEIDA"
WIFI_SENHA = "Amor@7854"

API_URL = "http://192.168.15.7:8000/api/clima"

# ==================================
# CONFIGURACAO DOS SENSORES
# ==================================

# Sensor DHT22
dht22 = dht.DHT22(Pin(4))

# Sensor LDR
ldr = ADC(Pin(35))
ldr.atten(ADC.ATTN_11DB)

# Sensor MQ-135
gas = ADC(Pin(34))
gas.atten(ADC.ATTN_11DB)

# BMP280: reservado para ativacao futura
# O sensor esta desconectado no momento.
sensor_bmp = None
pressao = 0

print("BMP280: leitura desativada temporariamente")

# ==================================
# CONEXAO WIFI
# ==================================

wifi = network.WLAN(network.STA_IF)

try:
    wifi.active(False)
    time.sleep(2)
except:
    pass

wifi.active(True)
time.sleep(2)

print("Conectando ao Wi-Fi...")

wifi.connect(WIFI_SSID, WIFI_SENHA)

# ==================================
# ENVIO DOS DADOS
# ==================================

print("Monitoramento SkySense iniciado!")

while True:
    try:
        # Leitura do DHT22
        dht22.measure()
        temperatura = dht22.temperature()
        umidade = dht22.humidity()

        # Leitura dos sensores analogicos
        luminosidade = ldr.read()
        gas_valor = gas.read()

        # Pressao: BMP280 desativado
        if sensor_bmp is not None:
            pressao = sensor_bmp.pressure / 100
        else:
            pressao = 0

        # Organizacao dos dados
        dados = {
            "usuario": "Guilherme",
            "temperatura": temperatura,
            "umidade": umidade,
            "pressao": pressao,
            "luminosidade": luminosidade,
            "gas": gas_valor,
            "cidade": "São Paulo",
            "estado": "SP"
        }

        # Exibicao no Thonny
        print("---------------------------")
        print("Temperatura:", temperatura, "C")
        print("Umidade:", umidade, "%")
        print("Pressao:", pressao, "hPa")
        print("Luminosidade:", luminosidade)
        print("Gas MQ-135:", gas_valor)

        # Envio para a API
        resposta = urequests.post(
            API_URL,
            json=dados,
            headers={"Content-Type": "application/json"}
        )

        print("Resposta da API:", resposta.status_code)
        resposta.close()

    except Exception as erro:
        print("Erro:", erro)

    time.sleep(5)

