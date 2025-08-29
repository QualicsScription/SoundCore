from fastapi import FastAPI, APIRouter, WebSocket, WebSocketDisconnect
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Dict, Set, Any
import uuid
from datetime import datetime, timezone
import asyncio
import json

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection (kept intact per instructions)
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
# DB name must come from environment only (no hardcoding)
db_name = os.environ.get('DB_NAME', 'app')
db = client[db_name]

# Create the main app without a prefix
app = FastAPI()

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# ----------------------------
# REST MODELS & ENDPOINTS (kept)
# ----------------------------
class StatusCheck(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    client_name: str
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class StatusCheckCreate(BaseModel):
    client_name: str

@api_router.get("/")
async def root():
    return {"message": "Hello World"}

@api_router.get("/health")
async def health():
    return {"ok": True, "time": datetime.now(timezone.utc).isoformat()}

@api_router.post("/status", response_model=StatusCheck)
async def create_status_check(input: StatusCheckCreate):
    # Store ISO strings for date/time in Mongo
    status_obj = StatusCheck(client_name=input.client_name)
    await db.status_checks.insert_one(status_obj.model_dump())
    return status_obj

@api_router.get("/status", response_model=List[StatusCheck])
async def get_status_checks():
    status_checks = await db.status_checks.find().to_list(1000)
    return [StatusCheck(**status_check) for status_check in status_checks]

# Include the router in the main app
app.include_router(api_router)

# ----------------------------
# CORS (kept)
# ----------------------------
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# ----------------------------
# WebSocket Signaling Server (/api/ws)
# ----------------------------
# Room structure: { room: { user_id: websocket } }
rooms: Dict[str, Dict[str, WebSocket]] = {}
# Connection metadata: { user_id: { 'room': str, 'name': str } }
users_meta: Dict[str, Dict[str, Any]] = {}
# Lock for concurrency
rooms_lock = asyncio.Lock()

async def send_json(ws: WebSocket, data: Dict[str, Any]):
    try:
        await ws.send_text(json.dumps(data))
    except Exception as e:
        logger.warning(f"Failed to send WS message: {e}")

async def broadcast_room(room: str, data: Dict[str, Any], exclude: Set[str] | None = None):
    exclude = exclude or set()
    async with rooms_lock:
        peers = rooms.get(room, {})
        targets = [(uid, ws) for uid, ws in peers.items() if uid not in exclude]
    for uid, ws in targets:
        await send_json(ws, data)

@api_router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    # Accept connection
    await websocket.accept()
    user_id = str(uuid.uuid4())
    joined_room = None
    display_name = None
    try:
        while True:
            msg_text = await websocket.receive_text()
            try:
                msg = json.loads(msg_text)
            except json.JSONDecodeError:
                await send_json(websocket, {"type": "error", "message": "Invalid JSON"})
                continue

            mtype = msg.get("type")

            if mtype == "join":
                # {type:'join', room:'room', name:'Alice'}
                joined_room = str(msg.get("room", "")).strip()
                display_name = str(msg.get("name") or f"User-{user_id[:5]}")
                if not joined_room:
                    await send_json(websocket, {"type": "error", "message": "room required"})
                    continue
                async with rooms_lock:
                    if joined_room not in rooms:
                        rooms[joined_room] = {}
                    # Build peers list before adding self
                    existing_peers = [
                        {"id": uid, "name": users_meta.get(uid, {}).get("name", f"User-{uid[:5]}")}
                        for uid in rooms[joined_room].keys()
                    ]
                    rooms[joined_room][user_id] = websocket
                    users_meta[user_id] = {"room": joined_room, "name": display_name}
                # Ack self with peer list and selfId
                await send_json(websocket, {"type": "joined", "selfId": user_id, "peers": existing_peers})
                # Notify others in room about new peer
                await broadcast_room(joined_room, {"type": "new-peer", "id": user_id, "name": display_name}, exclude={user_id})

            elif mtype in ("offer", "answer", "ice-candidate"):
                # Forward to target peer by id
                to_id = msg.get("to")
                if not to_id:
                    await send_json(websocket, {"type": "error", "message": "missing 'to'"})
                    continue
                async with rooms_lock:
                    target_ws = None
                    # Find target in any room (or restrict to same room if known)
                    if joined_room and to_id in rooms.get(joined_room, {}):
                        target_ws = rooms[joined_room][to_id]
                    else:
                        # Fallback: search all rooms
                        for rmap in rooms.values():
                            if to_id in rmap:
                                target_ws = rmap[to_id]
                                break
                if target_ws is None:
                    await send_json(websocket, {"type": "peer-unavailable", "to": to_id})
                    continue
                payload = {"type": mtype, "from": user_id}
                if mtype in ("offer", "answer"):
                    payload["sdp"] = msg.get("sdp")
                else:
                    payload["candidate"] = msg.get("candidate")
                await send_json(target_ws, payload)

            elif mtype == "text":
                # Broadcast chat message to room
                if not joined_room:
                    continue
                text = str(msg.get("message", ""))
                ts = datetime.now(timezone.utc).isoformat()
                from_name = display_name or f"User-{user_id[:5]}"
                await broadcast_room(joined_room, {
                    "type": "text",
                    "from": {"id": user_id, "name": from_name},
                    "message": text,
                    "timestamp": ts,
                })

            elif mtype == "leave":
                # Voluntary leave
                if joined_room:
                    async with rooms_lock:
                        rmap = rooms.get(joined_room, {})
                        if user_id in rmap:
                            del rmap[user_id]
                    await broadcast_room(joined_room, {"type": "leave", "id": user_id})
                    joined_room = None
                await send_json(websocket, {"type": "left"})

            else:
                await send_json(websocket, {"type": "error", "message": "Unknown message type"})

    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.exception(f"WebSocket error: {e}")
    finally:
        # Cleanup on disconnect
        if joined_room:
            async with rooms_lock:
                rmap = rooms.get(joined_room, {})
                if user_id in rmap:
                    del rmap[user_id]
            await broadcast_room(joined_room, {"type": "leave", "id": user_id})
        users_meta.pop(user_id, None)
        try:
            await websocket.close()
        except Exception:
            pass

@app.on_event("startup")
async def startup_event():
    logger.info("FastAPI application starting up...")
    logger.info("Available routes:")
    for route in app.routes:
        logger.info(f"  {route}")

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()