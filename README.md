 Hardware — Monitoramento Ambiental com ESP32

 Sobre a programação

A programação foi desenvolvida em **MicroPython**, utilizando o Thonny IDE para configurar o ESP32 e realizar a leitura periódica dos sensores conectados.

O código coleta dados ambientais, processa as leituras e apresenta os resultados no console, com intervalo de atualização de dois segundos.

## Sensores utilizados

- BMP280: leitura da pressão atmosférica.
- DHT22: medição de temperatura e umidade do ar.
- LDR: leitura analógica da intensidade luminosa.
- MQ-135: leitura analógica relacionada à presença de gases no ambiente.

 Tecnologias

- ESP32
- MicroPython
- Thonny IDE
- Comunicação I²C
- Conversão analógico-digital (ADC)

 Pinagem

| Componente | GPIO | Função |
|---|---|---|
| DHT22 | 4 | Dados |
| BMP280 | 21 | SDA |
| BMP280 | 22 | SCL |
| LDR | 35 | Leitura analógica |
| MQ-135 | 34 | Leitura analógica |

 Funcionamento

1. Inicialização do ESP32 e dos sensores.
2. Configuração dos pinos digitais, analógicos e da comunicação I²C.
3. Leitura dos dados a cada dois segundos.
4. Exibição das informações no console do Thonny IDE.
5. Tratamento básico de erros durante as leituras.

 Estrutura sugerida

```text
hardware/
├── README.md
├── main.py
├── dht.py
└── bmp280.py
```

Os arquivos de bibliotecas devem corresponder aos drivers utilizados na programação. O módulo `dht` pode já estar disponível no firmware MicroPython, dependendo da versão instalada.

 Observações

- O BMP280 utiliza comunicação I²C.
- O DHT22 fornece temperatura e umidade.
- O LDR e o MQ-135 utilizam entradas analógicas do ESP32.
- A leitura do MQ-135 representa um valor analógico bruto, não uma concentração de gás em ppm.
- Caso o MQ-135 seja alimentado por uma fonte externa, os aterramentos devem ser comuns e a tensão de saída enviada ao ESP32 não pode ultrapassar 3,3 V.

## Objetivo do branch

Este branch reúne os arquivos e as configurações relacionados ao hardware, à integração dos sensores e à programação embarcada do projeto.
