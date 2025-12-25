"""
Poker Agent API - Main Application

This service provides REST API endpoints for autonomous poker agents.
"""

from fastapi import FastAPI, HTTPException, Depends, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import requests
import os

app = FastAPI(
    title="Poker Agent API",
    description="REST API for autonomous poker agents to play poker",
    version="1.0.0"
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify exact origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configuration
FASTAPI_AUTH_URL = os.getenv("FASTAPI_AUTH_URL", "http://localhost:8000")
GAME_SERVER_URL = os.getenv("GAME_SERVER_URL", "http://localhost:3000")

# Request/Response Models
class ActionRequest(BaseModel):
    action: str  # fold, check, call, bet, raise, all-in
    amount: Optional[int] = None

class ActionResponse(BaseModel):
    success: bool
    gameState: dict

class GameStateResponse(BaseModel):
    gameState: dict

class ErrorResponse(BaseModel):
    error: str
    message: Optional[str] = None

# Authentication dependency
async def verify_token(authorization: Optional[str] = Header(None)) -> dict:
    """
    Verify JWT token by calling the auth service
    Returns user data if valid, raises HTTPException if invalid
    """
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing Authorization header")
    
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid Authorization header format")
    
    token = authorization.replace("Bearer ", "")
    
    try:
        # Verify token with auth service
        response = requests.post(
            f"{FASTAPI_AUTH_URL}/api/internal/auth/verify",
            json={"token": token},
            timeout=5
        )
        
        if response.status_code == 200:
            user_data = response.json()
            return user_data
        else:
            raise HTTPException(status_code=401, detail="Invalid or expired token")
    
    except requests.exceptions.RequestException as e:
        raise HTTPException(status_code=503, detail=f"Auth service unavailable: {str(e)}")

# Health check
@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "ok",
        "service": "poker-agent-api",
        "version": "1.0.0"
    }

# Get game state
@app.get("/api/v1/game/{game_id}/state", response_model=GameStateResponse)
async def get_game_state(
    game_id: str,
    user: dict = Depends(verify_token)
):
    """
    Get the current game state from the agent's perspective.
    
    This endpoint polls the game server for the current state.
    Agents should call this repeatedly to wait for their turn.
    """
    try:
        user_id = user.get("id")
        
        # Call internal game server endpoint
        response = requests.get(
            f"{GAME_SERVER_URL}/_internal/game/{game_id}/state",
            params={"userId": user_id},
            timeout=10
        )
        
        if response.status_code == 200:
            return response.json()
        elif response.status_code == 404:
            raise HTTPException(status_code=404, detail="Game not found")
        else:
            raise HTTPException(
                status_code=response.status_code,
                detail=response.json().get("error", "Failed to get game state")
            )
    
    except requests.exceptions.RequestException as e:
        raise HTTPException(
            status_code=503,
            detail=f"Game server unavailable: {str(e)}"
        )

# Perform action
@app.post("/api/v1/game/{game_id}/action", response_model=ActionResponse)
async def perform_action(
    game_id: str,
    action_request: ActionRequest,
    user: dict = Depends(verify_token)
):
    """
    Perform a poker action in the game.
    
    This endpoint blocks until the action is processed by the game server
    and returns the updated game state.
    
    Valid actions: fold, check, call, bet, raise, all-in
    """
    try:
        user_id = user.get("id")
        
        # Validate action
        valid_actions = ["fold", "check", "call", "bet", "raise", "all-in"]
        if action_request.action not in valid_actions:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid action. Must be one of: {', '.join(valid_actions)}"
            )
        
        # If action requires amount, validate it
        if action_request.action in ["bet", "raise"] and action_request.amount is None:
            raise HTTPException(
                status_code=400,
                detail=f"Action '{action_request.action}' requires an amount"
            )
        
        # Prepare request payload
        payload = {
            "userId": user_id,
            "gameId": game_id,
            "action": action_request.action
        }
        
        if action_request.amount is not None:
            payload["amount"] = action_request.amount
        
        # Call internal game server endpoint
        response = requests.post(
            f"{GAME_SERVER_URL}/_internal/agent-action",
            json=payload,
            timeout=30  # Longer timeout for action processing
        )
        
        if response.status_code == 200:
            return response.json()
        elif response.status_code == 400:
            # Invalid action
            error_data = response.json()
            raise HTTPException(
                status_code=400,
                detail=error_data.get("error", "Invalid action")
            )
        elif response.status_code == 404:
            raise HTTPException(status_code=404, detail="Game or player not found")
        else:
            raise HTTPException(
                status_code=response.status_code,
                detail=response.json().get("error", "Failed to perform action")
            )
    
    except requests.exceptions.Timeout:
        raise HTTPException(
            status_code=504,
            detail="Game server timeout - action may still be processing"
        )
    except requests.exceptions.RequestException as e:
        raise HTTPException(
            status_code=503,
            detail=f"Game server unavailable: {str(e)}"
        )

# Error handler for unexpected errors
@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    return {
        "error": "Internal server error",
        "message": str(exc)
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
