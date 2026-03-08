from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.dependencies import get_db
from app.models.commerce_price import CommercePrice
from app.models.item import Item
from app.models.recipe import Recipe

router = APIRouter(prefix="/api/debug", tags=["debug"])


@router.get("/items/{item_id}")
def get_item(item_id: int, db: Session = Depends(get_db)) -> dict:
	item = db.get(Item, item_id)
	if item is None:
		raise HTTPException(status_code=404, detail="Item not found")

	return {
		"id": item.id,
		"name": item.name,
		"type": item.type,
		"rarity": item.rarity,
		"level": item.level,
		"vendor_value": item.vendor_value,
		"flags": item.flags,
	}


@router.get("/recipes/{item_id}")
def get_recipe_for_output_item(item_id: int, db: Session = Depends(get_db)) -> dict:
	recipe = db.query(Recipe).filter(Recipe.output_item_id == item_id).first()
	if recipe is None:
		raise HTTPException(status_code=404, detail="Recipe not found")

	return {
		"recipe_id": recipe.id,
		"output_item_id": recipe.output_item_id,
		"output_item_count": recipe.output_item_count,
		"disciplines": recipe.disciplines,
		"ingredients": [
			{
				"item_id": ingredient.item_id,
				"count": ingredient.count,
			}
			for ingredient in recipe.ingredients
		],
	}


@router.get("/prices/{item_id}")
def get_price(item_id: int, db: Session = Depends(get_db)) -> dict:
	price = db.get(CommercePrice, item_id)
	if price is None:
		raise HTTPException(status_code=404, detail="Price not found")

	return {
		"item_id": price.item_id,
		"buy_price": price.buy_price,
		"buy_quantity": price.buy_quantity,
		"sell_price": price.sell_price,
		"sell_quantity": price.sell_quantity,
		"last_updated": price.last_updated.isoformat(),
	}