#!/usr/bin/env python

from google.cloud import firestore
from google.oauth2 import service_account
import os
from dotenv import load_dotenv
import argparse
import json

# Determine the directory of the script
script_dir = os.path.dirname(os.path.abspath(__file__))
env_path = os.path.join(script_dir, '../../.env')

# Load environment variables from .env file
load_dotenv(env_path)

def initialize_firestore(env_prefix):
    # Load the service account credentials from the JSON string
    credentials_json = os.getenv("FIREBASE_ADMINSDK_JSON")
    if not credentials_json:
        raise ValueError("FIREBASE_ADMINSDK_JSON environment variable is not set or is empty")

    try:
        credentials_dict = json.loads(credentials_json)
        credentials = service_account.Credentials.from_service_account_info(credentials_dict)
    except json.JSONDecodeError as e:
        raise ValueError(f"Error decoding JSON from FIREBASE_ADMINSDK_JSON: {e}")

    # Unset FIRESTORE_EMULATOR_HOST for production
    if "FIRESTORE_EMULATOR_HOST" in os.environ:
        del os.environ["FIRESTORE_EMULATOR_HOST"]

    try:
        return firestore.Client(credentials=credentials)
    except Exception as e:
        raise RuntimeError(f"Error initializing Firestore: {e}")

def count_documents(db, env_prefix):
    collection_name = f"{env_prefix}_chatLogs"
    docs = db.collection(collection_name).stream()
    count = sum(1 for _ in docs)
    print(f"Total documents in '{collection_name}' collection: {count}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Count documents in Firestore chatLogs collection.')
    parser.add_argument('-e', '--env', type=str, choices=['dev', 'prod'], required=True, help='Environment (dev or prod)')
    args = parser.parse_args()

    env_prefix = args.env
    try:
        db = initialize_firestore(env_prefix)
    except Exception as e:
        print(f"Error initializing Firestore: {e}")
        exit(1)

    count_documents(db, env_prefix)