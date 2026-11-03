# SkySense - Estação Meteorológica Inteligente

O **SkySense** é uma estação meteorológica de baixo custo construída com o microcontrolador **ESP32** para monitoramento ambiental urbano. O sistema realiza a coleta de dados de múltiplos sensores, transmite as leituras via requisições HTTP para uma API desenvolvida com **FastAPI**, armazena as informações em um banco de dados relacional **PostgreSQL** e exibe os dados em tempo real e em histórico através de um **Dashboard Web** responsivo com gráficos em **Chart.js**.

---

## 🛠️ Tecnologias e Componentes

* **Hardware & Firmware**: ESP32, DHT22 (Temperatura e Umidade), BMP280 (Pressão e Altitude), MQ-135 (Qualidade do Ar), LDR (Luminosidade), MicroPython.
* **Backend**: Python 3.10, FastAPI, SQLAlchemy (ORM), Pydantic, Uvicorn.
* **Banco de Dados**: PostgreSQL 15.
* **Frontend**: HTML5, CSS3, JavaScript (ES6+), Chart.js, Nginx.
* **Infraestrutura**: Docker & Docker Compose.

---

## 📁 Estrutura do Projeto

```text
Skysense/
├── .env
├── .gitignore
├── docker-compose.yml
├── README.md
├── backend/
│   ├── bmp280.py
│   ├── Dockerfile
│   ├── esp32.py
│   ├── main.py
│   └── requirements.txt
└── frontend/
    ├── Arquitetura simplificada do SkySense.PNG
    ├── Dockerfile
    ├── Esquema de liga o dos sensores ao ESP32.PNG
    ├── index.html
    ├── projeto.html
    ├── script.js
    ├── style.css
    └── styles.css
```

---

## 🚀 Como Executar o Ambiente Containerizado

### Pré-requisitos
* [Docker Desktop](https://www.docker.com/products/docker-desktop/) instalado e em execução.

### Subindo os Containers
1. Clone este repositório ou descompacte o código-fonte na sua máquina.
2. Navegue até a pasta raiz `Skysense` no seu terminal.
3. Garanta que o arquivo `.env` na raiz está configurado corretamente (veja o modelo abaixo).
4. Execute o comando:

```bash
docker compose up --build -d
```

### Acesso aos Serviços
* **Dashboard Web (Frontend)**: `http://localhost:3000`
* **Documentação Interativa da API (Swagger)**: `http://localhost:8000/docs`
* **Endpoint da API**: `http://localhost:8000/api/clima`
* **PostgreSQL**: `localhost:5432`

---

## 📄 Configuração de Variáveis de Ambiente (`.env`)

Crie ou edite o arquivo `.env` na raiz do projeto:

```env
DB_USER=postgres
DB_PASSWORD=Guiga@608925755
DB_HOST=db
DB_PORT=5432
DB_NAME=skysense_esp32
```

---

## 💻 Código-Fonte Completo do Projeto

---

### 1. Infraestrutura e Docker

#### `docker-compose.yml`
```yaml
version: '3.8'

services:
  db:
    image: postgres:15-alpine
    container_name: skysense_postgres
    restart: always
    environment:
      POSTGRES_USER: ${DB_USER:-postgres}
      POSTGRES_PASSWORD: ${DB_PASSWORD:-Guiga@608925755}
      POSTGRES_DB: ${DB_NAME:-skysense_esp32}
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    networks:
      - skysense-net

  backend:
    build: ./backend
    container_name: skysense_backend
    restart: always
    ports:
      - "8000:8000"
    environment:
      - DB_HOST=db
      - DB_USER=${DB_USER:-postgres}
      - DB_PASSWORD=${DB_PASSWORD:-Guiga@608925755}
      - DB_NAME=${DB_NAME:-skysense_esp32}
    depends_on:
      - db
    networks:
      - skysense-net

  frontend:
    build: ./frontend
    container_name: skysense_frontend
    restart: always
    ports:
      - "3000:80"
    depends_on:
      - backend
    networks:
      - skysense-net

volumes:
  postgres_data:
    driver: local

networks:
  skysense-net:
    driver: bridge
```

#### `backend/Dockerfile`
```dockerfile
FROM python:3.10-slim

WORKDIR /app

RUN apt-get update && apt-get install -y \
    gcc \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

#### `backend/requirements.txt`
```text
fastapi
uvicorn
sqlalchemy
psycopg2-binary
pydantic
```

#### `frontend/Dockerfile`
```dockerfile
FROM nginx:alpine

RUN rm -rf /usr/share/nginx/html/*

COPY . /usr/share/nginx/html/

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
```

---

### 2. Backend (FastAPI e Banco de Dados)

#### `backend/main.py`
```python
import os
from fastapi import FastAPI, HTTPException, status
from pydantic import BaseModel
from typing import Optional
from sqlalchemy import create_engine, Column, Float, Integer, String, DateTime
from sqlalchemy.orm import sessionmaker
from sqlalchemy.engine import URL
from sqlalchemy.orm import declarative_base
from datetime import datetime

app = FastAPI(
    title="API Estacao Meteorologica SkySense",
    description="Backend para recepcao e armazenamento de dados ambientais.",
    version="2.4.0"
)

# CONFIGURACAO DO POSTGRESQL VIA VARIAVEIS DE AMBIENTE
DB_USER = os.getenv("DB_USER", "postgres")
DB_PASSWORD = os.getenv("DB_PASSWORD", "Guiga@608925755")
DB_HOST = os.getenv("DB_HOST", "db")
DB_PORT = int(os.getenv("DB_PORT", 5432))
DB_NAME = os.getenv("DB_NAME", "skysense_esp32")

SKYSENSE_DB = {
    "Guilherme": {
        "url": URL.create(
            "postgresql+psycopg2",
            username=DB_USER,
            password=DB_PASSWORD,
            host=DB_HOST,
            port=DB_PORT,
            database=DB_NAME
        ),
        "cidade": "São Paulo",
        "estado": "SP"
    }
}

motores = {
    usuario: create_engine(
        dados["url"],
        pool_pre_ping=True,
        connect_args={"client_encoding": "utf8"}
    )
    for usuario, dados in SKYSENSE_DB.items()
}

sessoes_bd_usuario = {
    usuario: sessionmaker(
        bind=motor,
        autoflush=False,
        autocommit=False
    )
    for usuario, motor in motores.items()
}

Base = declarative_base()

class ModeloClimaHistorico(Base):
    __tablename__ = "clima_historico"
    id = Column(Integer, primary_key=True, index=True)
    temperatura = Column(Float)
    umidade = Column(Float)
    pressao = Column(Float)
    altitude = Column(Float, nullable=True)  # Suporte a altitude (BMP280)
    luminosidade = Column(Integer)
    gas = Column(Integer)
    cidade = Column(String, nullable=False)
    estado = Column(String, nullable=False)
    criado_em = Column(DateTime, default=datetime.now)

class DadosClimaSchema(BaseModel):
    usuario: str
    temperatura: Optional[float] = None
    umidade: Optional[float] = None
    pressao: Optional[float] = None
    altitude: Optional[float] = None     # Suporte a altitude (BMP280)
    luminosidade: Optional[int] = None
    gas: Optional[int] = None
    cidade: Optional[str] = None
    estado: Optional[str] = None

@app.on_event("startup")
def iniciar_banco():
    for usuario, motor in motores.items():
        Base.metadata.create_all(bind=motor)
        print("SkySense conectado ao banco de dados e tabelas verificadas!")

# ROTA POST - RECEBER DADOS
@app.post("/api/clima", status_code=status.HTTP_201_CREATED)
def receber_dados(dados: DadosClimaSchema):
    usuario = dados.usuario
    if usuario not in sessoes_bd_usuario:
        raise HTTPException(
            status_code=400,
            detail="Usuario nao configurado no servidor."
        )

    SessaoLocal = sessoes_bd_usuario[usuario]
    conexao = SessaoLocal()

    try:
        cidade_def = dados.cidade if dados.cidade else SKYSENSE_DB[usuario]["cidade"]
        estado_def = dados.estado if dados.estado else SKYSENSE_DB[usuario]["estado"]

        novo_registro = ModeloClimaHistorico(
            temperatura=dados.temperatura,
            umidade=dados.umidade,
            pressao=dados.pressao,
            altitude=dados.altitude,
            luminosidade=dados.luminosidade,
            gas=dados.gas,
            cidade=cidade_def,
            estado=estado_def
        )
        conexao.add(novo_registro)
        conexao.commit()
        conexao.refresh(novo_registro)
        print(f"[SUCESSO] Registro {novo_registro.id} recebido de ({usuario})")

        return {
            "status": "sucesso",
            "mensagem": "Dados armazenados com sucesso!",
            "id": novo_registro.id
        }
    except Exception as erro:
        conexao.rollback()
        print("[ERRO NO BANCO]:", erro)
        raise HTTPException(
            status_code=500,
            detail="Erro ao armazenar os dados."
        )
    finally:
        conexao.close()

# ROTA GET - CONSULTAR HISTORICO
@app.get("/api/clima/historico")
def consultar_historico(usuario: str = "Guilherme", limite: int = 50):
    if usuario not in sessoes_bd_usuario:
        raise HTTPException(
            status_code=400,
            detail="Usuario nao encontrado."
        )

    if limite < 1 or limite > 1000:
        raise HTTPException(
            status_code=400,
            detail="O limite deve estar entre 1 e 1000."
        )

    SessaoLocal = sessoes_bd_usuario[usuario]
    conexao = SessaoLocal()

    try:
        registros = (
            conexao.query(ModeloClimaHistorico)
            .order_by(ModeloClimaHistorico.id.desc())
            .limit(limite)
            .all()
        )

        dados = []
        for registro in registros:
            dados.append({
                "id": registro.id,
                "temperatura": registro.temperatura,
                "umidade": registro.umidade,
                "pressao": registro.pressao,
                "altitude": registro.altitude,
                "luminosidade": registro.luminosidade,
                "gas": registro.gas,
                "cidade": registro.cidade,
                "estado": registro.estado,
                "criado_em": registro.criado_em.isoformat() if registro.criado_em else None
            })

        return {
            "status": "sucesso",
            "quantidade": len(dados),
            "dados": dados
        }
    finally:
        conexao.close()
```

---

### 3. Firmware e Drivers do ESP32 (MicroPython)

#### `backend/bmp280.py`
```python
import ustruct

BMP280_I2C_ADDRESS = 0x76

class BMP280:
    def __init__(self, i2c, addr=BMP280_I2C_ADDRESS):
        self.i2c = i2c
        self.addr = addr
        self._read_calibration()

        # Configuracoes padrao do registrador
        self.i2c.writeto_mem(self.addr, 0xF4, b'\x27')
        self.i2c.writeto_mem(self.addr, 0xF5, b'\x00')

    def _read_calibration(self):
        calib = self.i2c.readfrom_mem(self.addr, 0x88, 24)
        (self.dig_T1, self.dig_T2, self.dig_T3,
         self.dig_P1, self.dig_P2, self.dig_P3, self.dig_P4, self.dig_P5,
         self.dig_P6, self.dig_P7, self.dig_P8, self.dig_P9) = ustruct.unpack('<HhhHhhhhhhhh', calib)

    def _read_raw(self):
        data = self.i2c.readfrom_mem(self.addr, 0xF7, 6)
        raw_pres = (data[0] << 12) | (data[1] << 4) | (data[2] >> 4)
        raw_temp = (data[3] << 12) | (data[4] << 4) | (data[5] >> 4)
        return raw_temp, raw_pres

    @property
    def temperature(self):
        raw_temp, _ = self._read_raw()
        var1 = (((raw_temp >> 3) - (self.dig_T1 << 1)) * self.dig_T2) >> 11
        var2 = (((((raw_temp >> 4) - self.dig_T1) * ((raw_temp >> 4) - self.dig_T1)) >> 12) * self.dig_T3) >> 14
        self.t_fine = var1 + var2
        return ((self.t_fine * 5 + 128) >> 8) / 100.0

    @property
    def pressure(self):
        self.temperature
        _, raw_pres = self._read_raw()

        var1 = self.t_fine - 128000
        var2 = var1 * var1 * self.dig_P6
        var2 = var2 + ((var1 * self.dig_P5) << 17)
        var2 = var2 + (self.dig_P4 << 35)
        var1 = ((var1 * var1 * self.dig_P3) >> 8) + ((var1 * self.dig_P2) << 12)
        var1 = (((1 << 47) + var1) * self.dig_P1) >> 33

        if var1 == 0:
            return 0

        p = 1048576 - raw_pres
        p = (((p << 31) - var2) * 3125) // var1
        var1 = (self.dig_P9 * (p >> 13) * (p >> 13)) >> 25
        var2 = (self.dig_P8 * p) >> 19
        p = ((p + var1 + var2) >> 8) + (self.dig_P7 << 4)
        return (p / 256.0) / 100.0  # Retorna em hPa

    @property
    def altitude(self):
        """Calcula a altitude estimada em metros baseada na pressao barometrica padrao ao nivel do mar (1013.25 hPa)."""
        p = self.pressure
        if p == 0:
            return 0.0
        return 44330.0 * (1.0 - (p / 1013.25) ** 0.1903)
```

#### `backend/esp32.py`
```python
from machine import Pin, ADC, I2C
import dht
import time
import urequests
from bmp280 import BMP280

# Configuracao dos pinos
dht22 = dht.DHT22(Pin(4))
ldr = ADC(Pin(35))
gas = ADC(Pin(34))
gas.atten(ADC.ATTN_11DB)

i2c = I2C(0, scl=Pin(22), sda=Pin(21), freq=100000)
bmp = BMP280(i2c)

API_URL = "http://192.168.1.100:8000/api/clima"  # Alterar para o IP do seu servidor

print("Monitoramento SkySense iniciado!")

while True:
    try:
        dht22.measure()
        temp = dht22.temperature()
        umid = dht22.humidity()
        pressao_val = bmp.pressure
        altitude_val = bmp.altitude
        ldr_val = ldr.read()
        gas_val = gas.read()

        payload = {
            "usuario": "Guilherme",
            "temperatura": temp,
            "umidade": umid,
            "pressao": pressao_val,
            "altitude": round(altitude_val, 2),
            "luminosidade": ldr_val,
            "gas": gas_val,
            "cidade": "São Paulo",
            "estado": "SP"
        }

        print("Enviando dados:", payload)
        response = urequests.post(API_URL, json=payload)
        print("Resposta API:", response.status_code, response.text)
        response.close()

    except Exception as erro:
        print("Erro durante ciclo de leitura/envio:", erro)

    time.sleep(5)
```

---

### 4. Frontend (HTML, CSS e JavaScript)

#### `frontend/index.html`
```html
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SkySense - Dashboard</title>
  <link rel="stylesheet" href="style.css">
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
</head>
<body>
  <header>
    <h1>SkySense Dashboard</h1>
    <nav>
      <a href="index.html" class="active">Dashboard</a>
      <a href="projeto.html">Projeto</a>
    </nav>
  </header>

  <main class="dashboard-container">
    <section class="cards-grid">
      <div class="card">
        <h3>Temperatura</h3>
        <p class="card-value" id="val-temp">-- °C</p>
      </div>
      <div class="card">
        <h3>Umidade</h3>
        <p class="card-value" id="val-umid">-- %</p>
      </div>
      <div class="card">
        <h3>Pressão</h3>
        <p class="card-value" id="val-press">-- hPa</p>
      </div>
      <div class="card">
        <h3>Altitude</h3>
        <p class="card-value" id="val-alt">-- m</p>
      </div>
      <div class="card">
        <h3>Luminosidade</h3>
        <p class="card-value" id="val-lum">--</p>
      </div>
      <div class="card">
        <h3>Qualidade do Ar</h3>
        <p class="card-value" id="val-gas">--</p>
      </div>
    </section>

    <section class="chart-section">
      <div class="tabs">
        <button class="tab active" data-tab="temperatura">Temperatura</button>
        <button class="tab" data-tab="umidade">Umidade</button>
        <button class="tab" data-tab="pressao">Pressão</button>
        <button class="tab" data-tab="altitude">Altitude</button>
        <button class="tab" data-tab="luminosidade">Luminosidade</button>
        <button class="tab" data-tab="gas">Qualidade do Ar</button>
      </div>
      <div class="chart-container">
        <canvas id="mainChart"></canvas>
      </div>
    </section>
  </main>

  <script src="script.js"></script>
</body>
</html>
```

#### `frontend/script.js`
```javascript
const API_URL = '/api/clima/historico?usuario=Guilherme&limite=50';

let chartInstance = null;
let currentMetric = 'temperatura';
let globalData = [];

const metricConfig = {
  temperatura: { label: 'Temperatura (°C)', color: '#ff6384' },
  umidade: { label: 'Umidade (%)', color: '#36a2eb' },
  pressao: { label: 'Pressão (hPa)', color: '#cc65fe' },
  altitude: { label: 'Altitude (m)', color: '#4bc0c0' },
  luminosidade: { label: 'Luminosidade (ADC)', color: '#ffce56' },
  gas: { label: 'Qualidade do Ar (ADC)', color: '#ff9f40' }
};

async function fetchData() {
  try {
    const res = await fetch(API_URL);
    const result = await res.json();
    if (result.status === 'sucesso' && result.dados.length > 0) {
      globalData = result.dados.reverse(); // Ordem cronológica
      updateCards(globalData[globalData.length - 1]);
      renderChart();
    }
  } catch (err) {
    console.error("Erro ao carregar dados da API:", err);
  }
}

function updateCards(latest) {
  document.getElementById('val-temp').innerText = latest.temperatura != null ? `${latest.temperatura} °C` : '--';
  document.getElementById('val-umid').innerText = latest.umidade != null ? `${latest.umidade} %` : '--';
  document.getElementById('val-press').innerText = latest.pressao != null ? `${latest.pressao} hPa` : '--';
  document.getElementById('val-alt').innerText = latest.altitude != null ? `${latest.altitude} m` : '--';
  document.getElementById('val-lum').innerText = latest.luminosidade != null ? latest.luminosidade : '--';
  document.getElementById('val-gas').innerText = latest.gas != null ? latest.gas : '--';
}

function renderChart() {
  const ctx = document.getElementById('mainChart').getContext('2d');
  const labels = globalData.map(d => new Date(d.criado_em).toLocaleTimeString());
  const dataValues = globalData.map(d => d[currentMetric]);

  if (chartInstance) {
    chartInstance.destroy();
  }

  chartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: metricConfig[currentMetric].label,
        data: dataValues,
        borderColor: metricConfig[currentMetric].color,
        backgroundColor: metricConfig[currentMetric].color + '33',
        fill: true,
        tension: 0.3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false
    }
  });
}

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', (e) => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    e.target.classList.add('active');
    currentMetric = e.target.dataset.tab;
    renderChart();
  });
});

// Atualização automática a cada 5 segundos
fetchData();
setInterval(fetchData, 5000);
```

#### `frontend/style.css`
```css
* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
}

body {
  background-color: #f4f7f6;
  color: #333;
}

header {
  background-color: #1e88e5;
  color: white;
  padding: 1rem 2rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

header nav a {
  color: white;
  text-decoration: none;
  margin-left: 1rem;
  font-weight: bold;
}

header nav a.active {
  text-decoration: underline;
}

.dashboard-container {
  padding: 2rem;
  max-width: 1200px;
  margin: 0 auto;
}

.cards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 1.5rem;
  margin-bottom: 2rem;
}

.card {
  background: white;
  padding: 1.5rem;
  border-radius: 8px;
  box-shadow: 0 4px 6px rgba(0,0,0,0.05);
  text-align: center;
}

.card h3 {
  font-size: 0.9rem;
  color: #666;
  margin-bottom: 0.5rem;
}

.card-value {
  font-size: 1.5rem;
  font-weight: bold;
  color: #1e88e5;
}

.chart-section {
  background: white;
  padding: 1.5rem;
  border-radius: 8px;
  box-shadow: 0 4px 6px rgba(0,0,0,0.05);
}

.tabs {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1rem;
  flex-wrap: wrap;
}

.tab {
  padding: 0.5rem 1rem;
  border: none;
  background: #e0e0e0;
  cursor: pointer;
  border-radius: 4px;
  font-weight: 500;
}

.tab.active {
  background: #1e88e5;
  color: white;
}

.chart-container {
  position: relative;
  height: 350px;
}
```

#### `frontend/projeto.html`
```html
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SkySense - Sobre o Projeto</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <nav id="menu">
    <a href="#inicio">Início</a>
    <a href="#projeto" aria-current="page">Projeto</a>
    <a href="#sensores">Componentes</a>
    <a href="index.html" class="botao-dashboard">Dashboard</a>
  </nav>

  <main class="conteudo">
    <h1>Sobre o Projeto SkySense</h1>
    <p>O SkySense é um projeto integrador acadêmico da Universidade Paulista (UNIP) com o objetivo de construir uma estação meteorológica de baixo custo utilizando microcontroladores e tecnologias de computação em nuvem e web.</p>
  </main>
</body>
</html>
```

#### `frontend/styles.css`
```css
body {
  font-family: Arial, sans-serif;
  margin: 0;
  background-color: #fafafa;
}

#menu {
  background-color: #333;
  padding: 1rem;
  display: flex;
  gap: 1rem;
}

#menu a {
  color: white;
  text-decoration: none;
}

.botao-dashboard {
  background-color: #008cba;
  padding: 0.3rem 0.8rem;
  border-radius: 4px;
}

.conteudo {
  padding: 2rem;
  max-width: 800px;
  margin: 0 auto;
}
```

---

## 📜 Licença
Projeto acadêmico desenvolvido para a disciplina de Projeto e Desenvolvimento II - **Universidade Paulista (UNIP)**.