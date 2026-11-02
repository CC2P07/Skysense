from fastapi import FastAPI, HTTPException, status
from pydantic import BaseModel
from typing import Optional
from sqlalchemy import create_engine, Column, Float, Integer, String, DateTime
from sqlalchemy.orm import sessionmaker
from sqlalchemy.engine import URL
from sqlalchemy.orm import declarative_base
from datetime import datetime
import os

# ==================================
# CONFIGURACAO DA API
# ==================================
app = FastAPI(
    title="API Estacao Meteorologica SkySense",
    description="Backend unificado para recepcao e armazenamento de dados ambientais.",
    version="3.0.0"
)

# ==================================
# CONFIGURACAO DO POSTGRESQL
# ==================================
DB_HOST = os.getenv("DB_HOST", "localhost")
DB_USER = os.getenv("DB_USER", "postgres")
DB_PASSWORD = os.getenv("DB_PASSWORD", "Guiga@608925755")
DB_NAME = os.getenv("DB_NAME", "skysense_esp32")

# URL de conexão para o banco de dados 
DATABASE_URL = URL.create(
    "postgresql+psycopg2",
    username=DB_USER,
    password=DB_PASSWORD,
    host=DB_HOST,
    port=5432,
    database=DB_NAME
)

engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    connect_args={"client_encoding": "utf8"}
)

SessionLocal = sessionmaker(
    bind=engine,
    autoflush=False,
    autocommit=False
)

Base = declarative_base()

# MODELO DA TABELA 
class ModeloClimaHistorico(Base):
    __tablename__ = "clima_historico"

    id = Column(Integer, primary_key=True, index=True)
    usuario = Column(String, nullable=False)
    temperatura = Column(Float, nullable=True)
    umidade = Column(Float, nullable=True)
    pressao = Column(Float, nullable=True)
    luminosidade = Column(Integer, nullable=True)
    gas = Column(Integer, nullable=True)
    cidade = Column(String, nullable=False)
    estado = Column(String, nullable=False)
    criado_em = Column(DateTime, default=datetime.now)

# FORMATO DADOS RECEBIDOS
class DadosClimaSchema(BaseModel):
    usuario: str
    temperatura: Optional[float] = None
    umidade: Optional[float] = None
    pressao: Optional[float] = None
    luminosidade: Optional[int] = None
    gas: Optional[int] = None
    cidade: str
    estado: str

# INICIALIZACAO DO BANCO 
@app.on_event("startup")
def iniciar_banco():
    # Cria a tabela unificada automaticamente no banco central
    Base.metadata.create_all(bind=engine)
    print("SkySense conectado ao banco de dados unificado e tabela verificada!")

# ROTA POST - RECEBER DADOS
@app.post("/api/clima", status_code=status.HTTP_201_CREATED)
def receber_dados(dados: DadosClimaSchema):
    conexao = SessionLocal()

    try:
        novo_registro = ModeloClimaHistorico(
            usuario=dados.usuario,
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

        print(f"[SUCESSO] Registro {novo_registro.id} salvo para o usuário '{dados.usuario}'")

        return {
            "status": "sucesso",
            "mensagem": "Dados armazenados com sucesso no banco unificado!",
            "id": novo_registro.id
        }

    except Exception as erro:
        conexao.rollback()
        print("[ERRO NO BANCO]:", erro)
        raise HTTPException(
            status_code=500,
            detail="Erro ao armazenar os dados no banco unificado."
        )
    finally:
        conexao.close()

# ROTA GET - CONSULTAR HISTORICO
@app.get("/api/clima/historico")
def consultar_historico(usuario: Optional[str] = None, limite: int = 50):
    if limite < 1 or limite > 1000:
        raise HTTPException(
            status_code=400,
            detail="O limite deve estar entre 1 e 1000."
        )

    conexao = SessionLocal()

    try:
        query = conexao.query(ModeloClimaHistorico)
        
        # Se um usuário específico for passado na query, filtra por ele; senão, traz geral
        if usuario:
            query = query.filter(ModeloClimaHistorico.usuario == usuario)

        registros = (
            query.order_by(ModeloClimaHistorico.id.desc())
            .limit(limite)
            .all()
        )

        dados = []
        for registro in registros:
            dados.append({
                "id": registro.id,
                "usuario": registro.usuario,
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
