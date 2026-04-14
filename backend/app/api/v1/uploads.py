from fastapi import APIRouter, UploadFile, File

from app.services.storage import upload_image

router = APIRouter(prefix="/v1/uploads", tags=["uploads"])


@router.post("/image")
async def upload_image_endpoint(file: UploadFile = File(...)) -> dict:
    contents = await file.read()
    url = upload_image(contents, file.filename or "image.png")
    return {"url": url, "filename": file.filename, "size": len(contents)}
