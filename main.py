from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI()

class DadosClima(BaseModel):
    temperatura: float
    umidade: float
    pressao: float
    luminosidade: int
    gas: int

@app.post("/api/clima")
def receive_data(data: DadosClima):
    print(f"Temperatura recebida: {data.temperatura}°C")
    print(f"Umidade recebida: {data.umidade}%")
    return {"status": "sucesso"}
