from fastapi import FastAPI, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import create_engine, Column, Float, Integer, String, DateTime
from sqlalchemy.orm import sessionmaker, Session
from datetime import datetime
from sqlalchemy.ext.declarative import declarative_base

app = FastAPI(
    title="API Estação Meteorológica Skysense",
    description="Backend multilocação para recepção de dados climáticos IoT.",
    version="2.2.0"
)

# 1. Dicionário de Bancos de Dados mantido exatamente no formato desejado
SKYSENSE_DB = {
    "Guilherme": {
        "url": "postgresql://postgres:skysense%23%40%21%21%40%23%40@localhost:5432/esp_skysense",
        "cidade": "São Paulo",
        "estado": "SP"
    }
}

# Motores e sessões dinâmicos cacheados para otimizar performance
motores = {
    usuario: create_engine(dados["url"]) 
    for usuario, dados in SKYSENSE_DB.items()
}

instancia_sessao_usuario = {
    usuario: sessionmaker(bind=motor) 
    for usuario, motor in motores.items()
}

Base = declarative_base()

# Definição completa da tabela com todos os sensores e geolocalização
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

# Schema Pydantic com nomenclatura descritiva em PT-BR (incluindo o usuário remetente)
class DadosClimaSchema(BaseModel):
    usuario: str
    temperatura: float
    umidade: float
    pressao: float
    luminosidade: int
    gas: int
    cidade: str
    estado: str

@app.post("/api/clima", status_code=status.HTTP_201_CREATED)
def receber_salvar_dados_climaticos(dados: DadosClimaSchema):
    """
    Recebe o pacote do ESP32, valida o usuário remetente no dicionário SKYSENSE_DB,
    e persiste todos os dados ambientais com geolocalização no PostgreSQL correspondente.
    """
    usuario_remetente = dados.usuario
    
    # Valida se o perfil/usuário remetente possui banco configurado
    if usuario_remetente not in instancia_sessao_usuario:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"O perfil '{usuario_remetente}' não possui um banco de dados mapeado no servidor."
        )
    
    # Seleciona a fábrica de sessão específica daquele perfil
    SessaoLocal = instancia_sessao_usuario[usuario_remetente]
    conexao_banco = SessaoLocal()
    
    try:
        # Garante que a tabela existe no banco de dados do perfil
        Base.metadata.create_all(bind=motores[usuario_remetente])
        
        # Instancia o registro mapeando TODOS os campos enviados
        novo_registro = ModeloClimaHistorico(
            temperatura=dados.temperatura,
            umidade=dados.umidade,
            pressao=dados.pressao,
            luminosidade=dados.luminosidade,
            gas=dados.gas,
            cidade=dados.cidade,
            estado=dados.estado
        )
        
        conexao_banco.add(novo_registro)
        conexao_banco.commit()
        conexao_banco.refresh(novo_registro)
        
        print(f"[SUCESSO] Dados salvos para o perfil '{usuario_remetente}'. ID: {novo_registro.id}")
        
        return {
            "status": "sucesso",
            "codigo_http": 201,
            "mensagem": f"Dados meteorológicos de {dados.cidade}/{dados.estado} armazenados com êxito.",
            "id_registro": novo_registro.id,
            "perfil": usuario_remetente
        }
        
    except Exception as erro:
        conexao_banco.rollback()
        print(f"[ERRO NO BANCO] Falha ao persistir: {erro}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro interno ao gravar dados no PostgreSQL: {str(erro)}"
        )
    finally:
        conexao_banco.close()

# Rota GET preparada previamente para o Dashboard
@app.get("/api/clima/historico", status_code=status.HTTP_200_OK)
def consultar_historico_clima(usuario: str, limite: int = 50):
    """
    Retorna o histórico de registros filtrado por perfil/usuário para exibição em painéis.
    """
    if usuario not in instancia_sessao_usuario:
        raise HTTPException(status_code=400, detail="Perfil de usuário não encontrado.")
        
    SessaoLocal = instancia_sessao_usuario[usuario]
    conexao_banco = SessaoLocal()
    
    try:
        registros = (
            conexao_banco.query(ModeloClimaHistorico)
            .order_by(ModeloClimaHistorico.criado_em.desc())
            .limit(limite)
            .all()
        )
        return {
            "status": "sucesso",
            "quantidade": len(registros),
            "dados": registros
        }
    finally:
        conexao_banco.close()
