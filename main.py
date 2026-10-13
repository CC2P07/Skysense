from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI()

class WeatherData(BaseModel):
    temperatura: float
    umidade: float
    pressao: float
    luminosidade: int
    gas: int

@app.post("/api/clima")
def receive_data(data: WeatherData):
    print(f"Temperatura recebida: {data.temperatura}°C")
    print(f"Umidade recebida: {data.umidade}%")
    return {"status": "sucesso"}
