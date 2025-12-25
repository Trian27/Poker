"""
Manually insert a hand into the database and test retrieval
"""
import psycopg2
import json
import uuid
from datetime import datetime

# Database connection
conn = psycopg2.connect(
    host="localhost",
    port=5432,
    database="poker_db",
    user="poker_user",
    password="poker_password"
)

cur = conn.cursor()

# Sample hand data
hand_data = {
    "pot": 50,
    "community_cards": ["Ah", "Kh", "Qh", "Jh", "10h"],
    "players": [
        {
            "user_id": 68,
            "username": "bot_player_1_1761441092",
            "seat_number": 1,
            "cards": ["As", "Ks"],
            "initial_stack": 500,
            "final_stack": 525,
            "folded": False,
            "all_in": False
        },
        {
            "user_id": 69,
            "username": "bot_player_2_1761441093",
            "seat_number": 2,
            "cards": ["2c", "3c"],
            "initial_stack": 500,
            "final_stack": 475,
            "folded": True,
            "all_in": False
        }
    ],
    "winner": {
        "username": "bot_player_1_1761441092",
        "amount": 50
    },
    "blinds": {
        "small_blind": 5,
        "big_blind": 10
    }
}

# Insert hand
hand_id = str(uuid.uuid4())
cur.execute("""
    INSERT INTO hand_history (id, community_id, table_id, table_name, hand_data, played_at)
    VALUES (%s, %s, %s, %s, %s, %s)
""", (
    hand_id,
    23,  # community_id from our test
    22,  # table_id from our test
    "Two Player Test",
    json.dumps(hand_data),
    datetime.now()
))

conn.commit()

print(f"✅ Inserted test hand with ID: {hand_id}")
print(f"   Community ID: 23")
print(f"   Table ID: 22")
print(f"   Players: {len(hand_data['players'])}")
print(f"   Pot: {hand_data['pot']} chips")
print(f"   Winner: {hand_data['winner']['username']}")

# Verify
cur.execute("SELECT COUNT(*) FROM hand_history")
count = cur.fetchone()[0]
print(f"\n📊 Total hands in database: {count}")

cur.close()
conn.close()

print("\n✅ Done! Now test with: python check_user_history.py bot_player_1_1761441092")
