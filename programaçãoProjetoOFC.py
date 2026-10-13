
from machine import Pin, ADC, I2C
import dht
import time
from bmp280 import BMP280

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

    except Exception as erro:
        print("Erro:", erro)

    time.sleep(2)
