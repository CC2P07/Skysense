
from machine import Pin, ADC, I2C
import dht
import time
import network
import urequests
import ujson
from bmp280 import BMP280

# ==================================
# CONFIGURACAO DA REDE E DA API
# ==================================

CONFIGURACAO = [
    {
        "nome": "Guilherme",
        "ssid": "ALEMIDA @LMEIDA",
        "senha": "Amor@7854",
        "api_url": "http://192.168.15.7:8000/api/clima",
        "cidade": "São Paulo",
        "estado": "SP"
    }
]

# ==================================
# CONEXAO WIFI
# ==================================

def conectar_wifi():
    wifi = network.WLAN(network.STA_IF)
    wifi.active(True)

    for perfil in CONFIGURACAO:
        print("Conectando em:", perfil["ssid"])

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
            print("Wi-Fi conectado!")
            print("IP do ESP32:", wifi.ifconfig()[0])
            return perfil

    print("Nenhuma rede encontrada.")
    return None


# ==================================
# CONFIGURACAO DOS SENSORES
# ==================================

dht22 = dht.DHT22(Pin(4))

ldr = ADC(Pin(35))
ldr.atten(ADC.ATTN_11DB)

gas = ADC(Pin(34))
gas.atten(ADC.ATTN_11DB)

# BMP280
i2c = I2C(0, scl=Pin(22), sda=Pin(21), freq=100000)

try:
    sensor_bmp = BMP280(i2c)
    print("BMP280 inicializado!")
except Exception as erro:
    sensor_bmp = None
    print("BMP280 indisponivel:", erro)


# ==================================
# INICIALIZACAO
# ==================================

perfil_ativo = conectar_wifi()

print("Monitoramento SkySense iniciado!")

# ==================================
# ENVIO DOS DADOS
# ==================================

while True:

    try:
        # Verifica a conexao Wi-Fi
        wifi = network.WLAN(network.STA_IF)

        if not wifi.isconnected() or perfil_ativo is None:
            print("Reconectando Wi-Fi...")
            perfil_ativo = conectar_wifi()

        # Leitura DHT22
        dht22.measure()
        temperatura = dht22.temperature()
        umidade = dht22.humidity()

        # Leituras analogicas
        luminosidade = ldr.read()
        gas_valor = gas.read()

        # Leitura BMP280
        if sensor_bmp is not None:
            pressao = sensor_bmp.pressure
        else:
            pressao = 0.0

        # Exibicao no Thonny
        print("---------------------------")
        print("Temperatura:", temperatura, "C")
        print("Umidade:", umidade, "%")
        print("Pressao:", pressao, "Pa")
        print("Luminosidade:", luminosidade)
        print("Gas MQ-135:", gas_valor)

        # Montagem dos dados
        if perfil_ativo is not None:

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

            print("Enviando dados para a API...")
            print(ujson.dumps(dados))

            # Envio HTTP POST
            resposta = urequests.post(
                perfil_ativo["api_url"],
                data=ujson.dumps(dados),
                headers={
                    "Content-Type": "application/json"
                }
            )

            print("Status HTTP:", resposta.status_code)
            print("Resposta:", resposta.text)

            resposta.close()

        else:
            print("Sem Wi-Fi. Dados nao enviados.")

    except Exception as erro:
        print("Erro no ciclo:", erro)

    # Intervalo entre leituras
    time.sleep(60)

