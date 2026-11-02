
import os
from datetime import datetime

from fastapi import FastAPI, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import (
    create_engine,
    Column,
    Float,
    Integer,
    String,
    DateTime,
)
from sqlalchemy.orm import sessionmaker, declarative_base
from sqlalchemy.engine import URL
from dotenv import load_dotenv

# ==========================================
# 1. CONFIGURAÇÃO DO AMBIENTE
# ==========================================

load_dotenv()

DB_USER = os.getenv("DB_USER")
DB_PASSWORD = os.getenv("DB_PASSWORD")
DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT = int(os.getenv("DB_PORT", "5432"))
DB_NAME = os.getenv("DB_NAME")

if not all([DB_USER, DB_PASSWORD, DB_NAME]):
    raise RuntimeError("Configure DB_USER, DB_PASSWORD e DB_NAME no .env")

DATABASE_URL = URL.create(
    drivername="postgresql+psycopg2",
    username=DB_USER,
    password=DB_PASSWORD,
    host=DB_HOST,
    port=DB_PORT,
    database=DB_NAME,
)

# ==========================================
# 2. CONEXÃO COM POSTGRESQL
# ==========================================

engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True
)

SessionLocal = sessionmaker(
    bind=engine,
    autoflush=False,
    autocommit=False
)

Base = declarative_base()

# ==========================================
# 3. CONFIGURAÇÃO DA API
# ==========================================

app = FastAPI(
    title="API Estação Meteorológica SkySense",
    description="API para recebimento de dados dos sensores ESP32.",
    version="2.3.0"
)

# ==========================================
# 4. MODELO DA TABELA
# ==========================================

class ModeloClimaHistorico(Base):
    __tablename__ = "clima_historico"

    id = Column(Integer, primary_key=True, index=True)
    temperatura = Column(Float)
    umidade = Column(Float)
    pressao = Column(Float)
    luminosidade = Column(Float)
    gas = Column(Integer)
    cidade = Column(String, nullable=False)
    estado = Column(String, nullable=False)
    criado_em = Column(DateTime, default=datetime.now)


# ==========================================
# 5. MODELO DOS DADOS RECEBIDOS
# ==========================================

class DadosClimaSchema(BaseModel):
    usuario: str
    temperatura: float
    umidade: float
    pressao: float
    luminosidade: float
    gas: int
    cidade: str = "São Paulo"
    estado: str = "SP"


# ==========================================
# 6. CRIAÇÃO AUTOMÁTICA DA TABELA
# ==========================================

@app.on_event("startup")
def iniciar_banco():
    Base.metadata.create_all(bind=engine)
    print("[SUCESSO] Conectado ao PostgreSQL!")
    print(f"[BANCO] {DB_NAME}")


# ==========================================
# 7. ROTA PRINCIPAL
# ==========================================

@app.get("/")
def inicio():
    return {
        "projeto": "SkySense",
        "status": "API funcionando",
        "versao": "2.3.0"
    }


# ==========================================
# 8. RECEBER E SALVAR DADOS DOS SENSORES
# ==========================================

@app.post("/api/clima", status_code=status.HTTP_201_CREATED)
def receber_salvar_dados(dados: DadosClimaSchema):

    if dados.usuario != "Guilherme":
        raise HTTPException(
            status_code=400,
            detail="Perfil de usuário não encontrado."
        )

    conexao = SessionLocal()

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

        print(f"[SUCESSO] Registro salvo: ID {novo_registro.id}")

        return {
            "status": "sucesso",
            "id_registro": novo_registro.id,
            "mensagem": "Dados armazenados no PostgreSQL."
        }

    except Exception as erro:
        conexao.rollback()
        print(f"[ERRO] {erro}")

        raise HTTPException(
            status_code=500,
            detail="Erro ao salvar dados no PostgreSQL."
        )

    finally:
        conexao.close()


# ==========================================
# 9. CONSULTAR HISTÓRICO
# ==========================================

@app.get("/api/clima/historico")
def consultar_historico(usuario: str, limite: int = 50):

    if usuario != "Guilherme":
        raise HTTPException(
            status_code=400,
            detail="Perfil não encontrado."
        )

    if limite < 1 or limite > 1000:
        raise HTTPException(
            status_code=400,
            detail="O limite deve estar entre 1 e 1000."
        )

    conexao = SessionLocal()

    try:
        registros = (
            conexao.query(ModeloClimaHistorico)
            .order_by(ModeloClimaHistorico.criado_em.desc())
            .limit(limite)
            .all()
        )

        return {
            "status": "sucesso",
            "quantidade": len(registros),
            "dados": [
                {
                    "id": item.id,
                    "temperatura": item.temperatura,
                    "umidade": item.umidade,
                    "pressao": item.pressao,
                    "luminosidade": item.luminosidade,
                    "gas": item.gas,
                    "cidade": item.cidade,
                    "estado": item.estado,
                    "criado_em": item.criado_em.isoformat()
                    if item.criado_em else None
                }
                for item in registros
            ]
        }

    finally:
        conexao.close()
