#!/usr/bin/env python3
"""
Backend WebSocket Testing for FastAPI /api/ws endpoint
Tests WebSocket signaling functionality including room management, 
signaling messages, and chat functionality.
"""

import asyncio
import websockets
import json
import os
from datetime import datetime
import sys

# Get backend URL from frontend .env file
def get_backend_url():
    try:
        with open('/app/frontend/.env', 'r') as f:
            for line in f:
                if line.startswith('REACT_APP_BACKEND_URL='):
                    url = line.split('=', 1)[1].strip()
                    # Convert http to ws scheme
                    if url.startswith('https://'):
                        return url.replace('https://', 'wss://') + '/api/ws'
                    elif url.startswith('http://'):
                        return url.replace('http://', 'ws://') + '/api/ws'
                    return url + '/api/ws'
    except Exception as e:
        print(f"Error reading frontend .env: {e}")
        return None
    return None

class WebSocketTestClient:
    def __init__(self, name, ws_url):
        self.name = name
        self.ws_url = ws_url
        self.websocket = None
        self.received_messages = []
        self.connected = False
        
    async def connect(self):
        try:
            print(f"[{self.name}] Connecting to {self.ws_url}")
            self.websocket = await websockets.connect(self.ws_url)
            self.connected = True
            print(f"[{self.name}] Connected successfully")
            return True
        except Exception as e:
            print(f"[{self.name}] Connection failed: {e}")
            return False
    
    async def send_message(self, message):
        if not self.connected or not self.websocket:
            print(f"[{self.name}] Not connected, cannot send message")
            return False
        try:
            await self.websocket.send(json.dumps(message))
            print(f"[{self.name}] Sent: {message}")
            return True
        except Exception as e:
            print(f"[{self.name}] Send failed: {e}")
            return False
    
    async def receive_message(self, timeout=5):
        if not self.connected or not self.websocket:
            return None
        try:
            message = await asyncio.wait_for(self.websocket.recv(), timeout=timeout)
            parsed = json.loads(message)
            self.received_messages.append(parsed)
            print(f"[{self.name}] Received: {parsed}")
            return parsed
        except asyncio.TimeoutError:
            print(f"[{self.name}] Receive timeout")
            return None
        except Exception as e:
            print(f"[{self.name}] Receive failed: {e}")
            return None
    
    async def disconnect(self):
        if self.websocket:
            try:
                await self.websocket.close()
                self.connected = False
                print(f"[{self.name}] Disconnected")
            except Exception as e:
                print(f"[{self.name}] Disconnect error: {e}")

async def test_websocket_signaling():
    """Main test function for WebSocket signaling"""
    
    print("=== FastAPI WebSocket Signaling Test ===")
    
    # Get WebSocket URL
    ws_url = get_backend_url()
    if not ws_url:
        print("❌ FAILED: Could not determine WebSocket URL from frontend .env")
        return False
    
    print(f"Testing WebSocket URL: {ws_url}")
    
    # Initialize test clients
    client_a = WebSocketTestClient("Alice", ws_url)
    client_b = WebSocketTestClient("Bob", ws_url)
    
    test_results = []
    
    try:
        # Test 1: Connect both clients
        print("\n--- Test 1: WebSocket Connection ---")
        connect_a = await client_a.connect()
        connect_b = await client_b.connect()
        
        if not connect_a or not connect_b:
            test_results.append("❌ WebSocket Connection: Failed to connect clients")
            return False
        
        test_results.append("✅ WebSocket Connection: Both clients connected successfully")
        
        # Test 2: Client A joins room
        print("\n--- Test 2: Client A Joins Room ---")
        join_msg_a = {"type": "join", "room": "e2e", "name": "Alice"}
        await client_a.send_message(join_msg_a)
        
        # Expect 'joined' message with selfId and empty peers
        response_a = await client_a.receive_message()
        if not response_a or response_a.get("type") != "joined":
            test_results.append("❌ Client A Join: Did not receive 'joined' message")
            return False
        
        if "selfId" not in response_a or "peers" not in response_a:
            test_results.append("❌ Client A Join: Missing selfId or peers in response")
            return False
        
        if len(response_a["peers"]) != 0:
            test_results.append("❌ Client A Join: Expected empty peers list initially")
            return False
        
        alice_id = response_a["selfId"]
        test_results.append("✅ Client A Join: Received proper 'joined' message with selfId and empty peers")
        
        # Test 3: Client B joins same room
        print("\n--- Test 3: Client B Joins Same Room ---")
        join_msg_b = {"type": "join", "room": "e2e", "name": "Bob"}
        await client_b.send_message(join_msg_b)
        
        # Client B should receive 'joined' with Alice in peers
        response_b = await client_b.receive_message()
        if not response_b or response_b.get("type") != "joined":
            test_results.append("❌ Client B Join: Did not receive 'joined' message")
            return False
        
        if len(response_b["peers"]) != 1 or response_b["peers"][0]["name"] != "Alice":
            test_results.append("❌ Client B Join: Expected Alice in peers list")
            return False
        
        bob_id = response_b["selfId"]
        
        # Client A should receive 'new-peer' for Bob
        new_peer_msg = await client_a.receive_message()
        if not new_peer_msg or new_peer_msg.get("type") != "new-peer":
            test_results.append("❌ Client B Join: Alice did not receive 'new-peer' message")
            return False
        
        if new_peer_msg.get("name") != "Bob":
            test_results.append("❌ Client B Join: 'new-peer' message has wrong name")
            return False
        
        test_results.append("✅ Client B Join: Proper room joining with peer notifications")
        
        # Test 4: Signaling Messages Exchange
        print("\n--- Test 4: Signaling Messages (Offer/Answer/ICE) ---")
        
        # A sends offer to B
        offer_msg = {
            "type": "offer",
            "to": bob_id,
            "sdp": "v=0\r\no=alice 2890844526 2890844527 IN IP4 host.atlanta.com\r\ns=-\r\nc=IN IP4 host.atlanta.com\r\nt=0 0\r\nm=audio 49170 RTP/AVP 0\r\na=rtpmap:0 PCMU/8000"
        }
        await client_a.send_message(offer_msg)
        
        # B should receive the offer
        offer_received = await client_b.receive_message()
        if not offer_received or offer_received.get("type") != "offer":
            test_results.append("❌ Signaling: Bob did not receive offer")
            return False
        
        if offer_received.get("from") != alice_id or "sdp" not in offer_received:
            test_results.append("❌ Signaling: Offer message format incorrect")
            return False
        
        # B sends answer to A
        answer_msg = {
            "type": "answer",
            "to": alice_id,
            "sdp": "v=0\r\no=bob 2890844526 2890844527 IN IP4 host.atlanta.com\r\ns=-\r\nc=IN IP4 host.atlanta.com\r\nt=0 0\r\nm=audio 49170 RTP/AVP 0\r\na=rtpmap:0 PCMU/8000"
        }
        await client_b.send_message(answer_msg)
        
        # A should receive the answer
        answer_received = await client_a.receive_message()
        if not answer_received or answer_received.get("type") != "answer":
            test_results.append("❌ Signaling: Alice did not receive answer")
            return False
        
        if answer_received.get("from") != bob_id or "sdp" not in answer_received:
            test_results.append("❌ Signaling: Answer message format incorrect")
            return False
        
        # Exchange ICE candidates
        ice_a_to_b = {
            "type": "ice-candidate",
            "to": bob_id,
            "candidate": "candidate:1 1 UDP 2130706431 192.168.1.100 54400 typ host"
        }
        await client_a.send_message(ice_a_to_b)
        
        ice_received_b = await client_b.receive_message()
        if not ice_received_b or ice_received_b.get("type") != "ice-candidate":
            test_results.append("❌ Signaling: Bob did not receive ICE candidate")
            return False
        
        ice_b_to_a = {
            "type": "ice-candidate",
            "to": alice_id,
            "candidate": "candidate:1 1 UDP 2130706431 192.168.1.101 54401 typ host"
        }
        await client_b.send_message(ice_b_to_a)
        
        ice_received_a = await client_a.receive_message()
        if not ice_received_a or ice_received_a.get("type") != "ice-candidate":
            test_results.append("❌ Signaling: Alice did not receive ICE candidate")
            return False
        
        test_results.append("✅ Signaling Messages: Offer/Answer/ICE exchange working correctly")
        
        # Test 5: Chat Messages
        print("\n--- Test 5: Chat Messages ---")
        
        chat_msg = {"type": "text", "message": "hello"}
        await client_a.send_message(chat_msg)
        
        # Both A and B should receive the text message
        text_received_a = await client_a.receive_message()
        text_received_b = await client_b.receive_message()
        
        if not text_received_a or text_received_a.get("type") != "text":
            test_results.append("❌ Chat: Alice did not receive her own text message")
            return False
        
        if not text_received_b or text_received_b.get("type") != "text":
            test_results.append("❌ Chat: Bob did not receive text message")
            return False
        
        # Validate message structure
        for msg in [text_received_a, text_received_b]:
            if not all(key in msg for key in ["from", "message", "timestamp"]):
                test_results.append("❌ Chat: Text message missing required fields")
                return False
            
            if msg["message"] != "hello":
                test_results.append("❌ Chat: Text message content incorrect")
                return False
            
            if not isinstance(msg["from"], dict) or "id" not in msg["from"] or "name" not in msg["from"]:
                test_results.append("❌ Chat: Text message 'from' field format incorrect")
                return False
        
        test_results.append("✅ Chat Messages: Text broadcasting working correctly")
        
        # Test 6: Disconnect handling
        print("\n--- Test 6: Disconnect Handling ---")
        
        # Disconnect Bob
        await client_b.disconnect()
        
        # Alice should receive 'leave' message
        leave_msg = await client_a.receive_message()
        if not leave_msg or leave_msg.get("type") != "leave":
            test_results.append("❌ Disconnect: Alice did not receive 'leave' message")
            return False
        
        if leave_msg.get("id") != bob_id:
            test_results.append("❌ Disconnect: 'leave' message has wrong user ID")
            return False
        
        test_results.append("✅ Disconnect Handling: Leave notifications working correctly")
        
        # Test 7: JSON Validation
        print("\n--- Test 7: JSON Validation ---")
        
        # All messages received should be valid JSON (already validated by json.loads)
        total_messages = len(client_a.received_messages) + len(client_b.received_messages)
        test_results.append(f"✅ JSON Validation: All {total_messages} messages were valid JSON")
        
        return True
        
    except Exception as e:
        test_results.append(f"❌ Test Exception: {str(e)}")
        return False
    
    finally:
        # Cleanup
        await client_a.disconnect()
        await client_b.disconnect()
        
        # Print results
        print("\n=== TEST RESULTS ===")
        for result in test_results:
            print(result)
        
        return len([r for r in test_results if r.startswith("✅")]) == len(test_results)

async def main():
    """Main entry point"""
    success = await test_websocket_signaling()
    
    if success:
        print("\n🎉 ALL TESTS PASSED: WebSocket signaling is working correctly!")
        return 0
    else:
        print("\n💥 SOME TESTS FAILED: WebSocket signaling has issues!")
        return 1

if __name__ == "__main__":
    exit_code = asyncio.run(main())
    sys.exit(exit_code)