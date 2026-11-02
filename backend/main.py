from fastapi import FastAPI, HTTPException, status
from pydantic import BaseModel
from typing import Optional
from sqlalchemy import create_engine, Column, Float, Integer, String, DateTime
from sqlalchemy.orm import sessionmaker
from sqlalchemy.engine import URL
from sqlalchemy.orm import declarative_base
from datetime import datetime

# ==================================
# CONFIGURACAO DA API
# ==================================
app = FastAPI(
    title="API Estacao Meteorologica SkySense",
    description="Backend para recepcao e armazenamento de dados ambientais.",
    version="2.3.0"
)

# ==================================
# CONFIGURACAO DO POSTGRESQL
# ==================================
SKYSENSE_DB = {
    "Guilherme": {
        "url": URL.create(
            "postgresql+psycopg2",
            username="postgres",
            password="Guiga@608925755",
            host="localhost",
            port=5432,
            database="skysense_esp32"
        ),
        "cidade": "São Paulo",
        "estado": "SP"
    }
}

# Motores e sessões otimizados com pool_pre_ping
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

# ==================================
# MODELO DA TABELA
# ==================================
class ModeloClimaHistorico(Base):
    __tablename__ = "clima_historico"

    id = Column(Integer, primary_key=True, index=True)
    temperatura = Column(Float)
    umidade = Column(Float)
    pressao = Column(Float)
    luminosidade = Column(Integer)
    gas = Column(Integer)
    cidade = Column(String, nullable=False)
    estado = Column(String, nullable=False)
    criado_em = Column(DateTime, default=datetime.now)

# ==================================
# SCHEMA DOS DADOS RECEBIDOS
# ==================================
class DadosClimaSchema(BaseModel):
    usuario: str
    temperatura: Optional[float] = None
    umidade: Optional[float] = None
    pressao: Optional[float] = None
    luminosidade: Optional[int] = None
    gas: Optional[int] = None
    cidade: str
    estado: str

# ==================================
# INICIALIZACAO DO BANCO (STARTUP)
# ==================================
@app.on_event("startup")
def iniciar_banco():
    for usuario, motor in motores.items():
        Base.metadata.create_all(bind=motor)
    print("SkySense conectado ao banco de dados e tabelas verificadas!")

# ==================================
# ROTA POST - RECEBER DADOS
# ==================================
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
        novo_registro = ModeloClimaHistorico(
            temperatura=dados.temperatura,
            umidade=dados.umidade,
            pressao=dados.pressao,
            luminosidade=dados.luminosidade,
            gas=dados.gas,
            cidade=dados.cidade,
            estado=dados.estado
        )

        conexao.add(novo_registro)
        conexao.commit()
        conexao.refresh(novo_registro)

        print(f"[SUCESSO] Registro {novo_registro.id} recebido de {usuario}")

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

# ==================================
# ROTA GET - CONSULTAR HISTORICO
# ==================================
@app.get("/api/clima/historico")
def consultar_historico(usuario: str, limite: int = 50):
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
                "luminosidade": registro.luminosidade,
                "gas": registro.gas,
                "cidade": registro.cidade,
                "estado": registro.estado,
                "criado_em": (
                    registro.criado_em.isoformat()
                    if registro.criado_em else None
                )
            })

        return {
            "status": "sucesso",
            "quantidade": len(dados),
            "dados": dados
        }

    finally:
        conexao.close()
