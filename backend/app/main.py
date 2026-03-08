from fastapi import FastAPI

app = FastAPI(title="GW2 Craft Profit Tool API")


@app.get("/api/health")
def health_check() -> dict[str, str]:
	return {"status": "ok"}