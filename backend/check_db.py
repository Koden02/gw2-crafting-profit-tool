import sqlite3
from pathlib import Path

base_dir = Path(__file__).resolve().parents[1]
db_path = base_dir / "data" / "gw2_profit.sqlite"

print("Using DB:", db_path)

conn = sqlite3.connect(db_path)
cursor = conn.cursor()

cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
tables = cursor.fetchall()

print("Tables:")
for table in tables:
	print(table[0])

conn.close()