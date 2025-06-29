#!/usr/bin/env python

import argparse
import json
import os
from datetime import datetime

from google.cloud import firestore
from google.oauth2 import service_account

from pyutil.env_utils import load_env


def initialize_firestore(env_prefix):
    # Load the service account credentials from the JSON string
    credentials_json = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
    if not credentials_json:
        raise ValueError("GOOGLE_APPLICATION_CREDENTIALS environment variable is not set or is empty")

    try:
        credentials_dict = json.loads(credentials_json)
        credentials = service_account.Credentials.from_service_account_info(credentials_dict)
    except json.JSONDecodeError as e:
        raise ValueError(f"Error decoding JSON from GOOGLE_APPLICATION_CREDENTIALS: {e}")

    # if env_prefix == 'dev':
    #     firestore_emulator_host = os.getenv("FIRESTORE_EMULATOR_HOST")
    #     if firestore_emulator_host:
    #         os.environ["FIRESTORE_EMULATOR_HOST"] = firestore_emulator_host
    # else:
    # Unset FIRESTORE_EMULATOR_HOST for production
    if "FIRESTORE_EMULATOR_HOST" in os.environ:
        del os.environ["FIRESTORE_EMULATOR_HOST"]

    try:
        return firestore.Client(credentials=credentials)
    except Exception as e:
        raise RuntimeError(f"Error initializing Firestore: {e}")

def convert_to_serializable(data):
    if isinstance(data, dict):
        return {k: convert_to_serializable(v) for k, v in data.items()}
    elif isinstance(data, list):
        return [convert_to_serializable(v) for v in data]
    elif isinstance(data, datetime):
        return data.isoformat()
    return data

def strip_words_from_sources(sources):
    try:
        sources_list = json.loads(sources)
        for source in sources_list:
            if 'full_info' in source['metadata']:
                del source['metadata']['full_info']
        return json.dumps(sources_list)
    except json.JSONDecodeError:
        return sources

def fetch_and_print_question(db, env_prefix, question_id):
    doc_ref = db.collection(f"{env_prefix}_chatLogs").document(question_id)
    doc = doc_ref.get()
    if not doc.exists:
        print(f"Question with ID {question_id} not found.")
        return

    data = doc.to_dict()
    if 'sources' in data:
        data['sources'] = strip_words_from_sources(data['sources'])

    serializable_data = convert_to_serializable(data)
    print(json.dumps(serializable_data, indent=2))

    if 'relatedQuestionsV2' in serializable_data and serializable_data['relatedQuestionsV2']:
        print("\n\nrelated questions:")
        print(json.dumps(serializable_data['relatedQuestionsV2'], indent=2))

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Fetch and print a Firestore question document, stripping out words from sources.')
    parser.add_argument('-e', '--env', type=str, choices=['dev', 'prod'], default='dev', help='Environment (dev or prod)')
    parser.add_argument('-q', '--question_id', type=str, default='noZ9ZiY5QzkSbmv9pEpA', help='Question ID to fetch')
    parser.add_argument('--site', required=True, help='Site ID for environment variables')
    args = parser.parse_args()

    # Load environment variables
    load_env(args.site)

    env_prefix = args.env
    try:
        db = initialize_firestore(env_prefix)
    except Exception as e:
        print(f"Error initializing Firestore: {e}")
        exit(1)

    fetch_and_print_question(db, env_prefix, args.question_id)