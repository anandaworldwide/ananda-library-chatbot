# The Ananda Chatbot - A RAG Chatbot for Your PDF Files, Audio Files, and YouTube Videos

[![Run All Tests](https://github.com/anandaworldwide/ananda-library-chatbot/actions/workflows/tests.yml/badge.svg)](https://github.com/anandaworldwide/ananda-library-chatbot/actions/workflows/tests.yml)
[![Comprehensive Tests](https://github.com/anandaworldwide/ananda-library-chatbot/actions/workflows/comprehensive-tests.yml/badge.svg)](https://github.com/anandaworldwide/ananda-library-chatbot/actions/workflows/comprehensive-tests.yml)

Build a chatGPT chatbot for multiple Large PDF files, audio files, and YouTube
videos. Optionally generate the PDF fileset from a Wordpress database.
Transcribe mp3 files en masse. Download YouTube videos en masse and transcribe
their audio. Allow users to share the best answers they get with each other
through a social sharing interface.

Audio and video results are shown inline with a player queued to the moment
matched in the transcript!

Tech stack used includes LangChain, Pinecone, Typescript, Openai, Next.js,
Google Firestore, AWS, and Python. LangChain is a framework that makes it easier
to build scalable AI/LLM apps and chatbots. Pinecone is a vectorstore for
storing embeddings to later retrieve similar docs.

[Tutorial video from project we forked from](https://www.youtube.com/watch?v=ih9PBGVVOO4)

The visual guide of this repo and tutorial is in the `visual guide` folder.

**If you run into errors, please review the troubleshooting section further down
this page.**

Prelude: Please make sure you have already downloaded node on your system and
the version is 18 or greater.

## Forked Version

This is a fork of gpt4-pdf-chatbot-langchain. This version looks for a specified
source in the Subject metadata of the PDF file.

## Generate PDF's to use from Wordpress MySQL database

For the Ananda Library, we have provided code that can take a wordpress MySQL
database and generate PDF files for all of the published content. For us, that
is about 7,000 documents.

we have also transcribed and ingested 1,500 Audio files and 800+ YouTube videos.

## Enhanced Frontend with Social Media Sharing

The runtime website code is significantly extended from the forked project. We
have added

- Display of sources with links and inline audio/video players
- Thumbs up for social feedback and thumbs down for system feedback
- Copy button
- All Answers page for social sharing
- Dedicate page for an answer
- Related questions

## Development

### Prerequisites

1. Node.js (version 18+)
2. Python 3.12.3
3. Firebase CLI

### Node.js Setup

Install Node.js from [nodejs.org](https://nodejs.org/) (version 18+)

### Clone the repo or download the ZIP

1. Clone the repo or download the ZIP

   git clone [github https url]

1. Install node packages

```bash
npm install
```

After installation, you should now see a `node_modules` folder.

### Environment Variables Setup

1. Copy the example environment file and create site-specific configs:

   ```bash
   cp .env.example .env
   cp .env.example .env.[site]
   ```

   Replace [site] with your specific site name (e.g., ananda).

2. Fill in the required values in `.env`:
   - OPENAI_API_KEY
   - PINECONE_API_KEY
   - PINECONE_INDEX_NAME
   - GOOGLE_APPLICATION_CREDENTIALS
   - Etc.

- Visit [openai](https://help.openai.com/en/articles/4936850-where-do-i-find-my-secret-api-key)
  to retrieve API keys and insert into your `.env` file.
- Visit [pinecone](https://pinecone.io/) to create and retrieve your API keys, and also retrieve
  your environment and index name from the dashboard. Be sure to use 1,536 as dimensions when setting
  up your pinecone index.
- Visit [upstash](https://upstash.com/) to create an upstash function to cache keywords for related questions.

### Site Configurations

1. Create a new JSON file for your site in the `site-config` directory. Name it `your-site-name.json`.

2. Use the following structure as a template, customizing the values for your site:

```json
{
  "name": "Your Site Name",
  "tagline": "Your site's tagline",
  "greeting": "Welcome message for users",
  etc.
}
```

### Optional: Firebase Emulator Setup

The Firebase Emulator is optional for local development. It is used to
simulate the behavior of Firebase services in a local environment. You don't
need it to run the chatbot, but it is useful for local development and
debugging, and to avoid charges for using the Firebase services.

1. Install Firebase CLI:

   ```bash
   npm install -g firebase-tools
   ```

2. Login to Firebase:

   ```bash
   firebase login
   ```

3. Initialize Firebase emulators:

   ```bash
   firebase init emulators
   ```

4. Add to your environment (e.g., .bashrc):

   ```bash
   export FIRESTORE_EMULATOR_HOST="127.0.0.1:8080"
   ```

### Setup python virtual environment

1. Install pyenv (if not already installed):

   For macOS/Linux:

   ```bash
   curl https://pyenv.run | bash
   ```

   For Windows, use pyenv-win:

   ```powershell
   Invoke-WebRequest -UseBasicParsing \
    -Uri "https://raw.githubusercontent.com/pyenv-win/pyenv-win/master/pyenv-win/install-pyenv-win.ps1" \
    -OutFile "./install-pyenv-win.ps1"; &"./install-pyenv-win.ps1"
   ```

2. Install Python 3.12.3:

   ```bash
   pyenv install 3.12.3
   ```

3. Create a virtual environment with pyenv:

   ```bash
   pyenv virtualenv 3.12.3 ananda-library-chatbot
   ```

4. Activate it automatically when you enter the directory:

   ```bash
   pyenv local ananda-library-chatbot
   ```

## Data Ingestion

### Optional: Generate PDF files from Wordpress Database

If you don't already have PDF files, you can generate them from a Wordpress
database.

#### Import MySQL database dump into local MySQL

First, you need to import a MySQL data dump from wordpress into local MySQL
(or set up access to the DB).

You can use the `python/bin/process_anandalib_dump.py` script to process and import an Ananda Library SQL dump:

```bash
python python/bin/process_anandalib_dump.py -u [mysql_username] [path_to_sql_dump]
```

This script:

- Creates a new database with name format `anandalib-YYYY-MM-DD`
- Processes the SQL dump to fix date formats and add necessary columns
- Imports the processed SQL into the new database

While this script is specifically tuned for the Ananda Library database structure,
it can be modified to work with other WordPress or MySQL database dumps. The core
functionality of creating a dated database, processing SQL to fix compatibility
issues, and importing the data can be adapted to different schema requirements.

#### Convert to PDFs

Second, you run _python db-to-pdfs.py_ from the `python/data-ingestion/db-to-pdf/`
directory to generate PDF files.

### Convert your PDF files to embeddings

This repo can load multiple PDF files.

1. Inside `python/data-ingestion/docs` folder, add your pdf files or folders that contain pdf files.

1. Run the script `npm run ingest` to 'ingest' and embed your docs. If you run into errors troubleshoot below.

You can add arguments like this:

```bash
npm run ingest --dryrun --site [site]
```

1. Check Pinecone dashboard to verify your namespace and vectors have been added.

### Transcribe MP3 files and YouTube videos and convert to embeddings

Put your MP3 files in `data-ingestion/media/`, in subfolders. Create a list of YouTube videos or
playlists. Then add files to the processing queue and process them.

#### Audio files

Add all audio files in a folder hierarchy like this:

```bash
python ingest_queue.py  --audio 'media/to-process' --author 'Swami Kriyananda' --library 'Ananda Sangha' --site ananda
```

#### YouTube playlists

You can add a whole playlist at a time. Or you can give it individual videos.

```bash
python ingest_queue.py \
 --playlist 'https://www.youtube.com/playlist?list=PLr4btvSEPHax_vE48QrYJUYOKpXbeSmfC' \
 --author 'Swami Kriyananda' --library 'Ananda Sangha' --site ananda
```

`--playlists-file` is an option to specify an Excel file with a list of YouTube playlists. See sample file `youtube-links-sample.xlsx`.

Then process the queue:

```bash
python data_ingestion/scripts/transcribe_and_ingest_media.py
```

Check Pinecone dashboard to verify your namespace and vectors have been added.

## Run the unit tests

```bash
python -m unittest discover -s python/data_ingestion/tests/ -p 'test*.py'
```

## Running the Development Server

Start the development server for a specific site:

```bash
npm run dev [site]
```

Go to `http://localhost:3000` and type a question in the chat interface!

## Troubleshooting

In general, keep an eye out in the `issues` and `discussions` section of this repo for solutions.

### General errors

- Make sure you're running the latest Node version. Run `node -v`
- Try a different PDF or convert your PDF to text first. It's possible your PDF is corrupted, scanned, or
  requires OCR to convert to text.
- `Console.log` the `env` variables and make sure they are exposed.
- Make sure you're using the same versions of LangChain and Pinecone as this repo.
- Check that you've created an `.env.[site]` file that contains your valid (and working) API keys,
  environment and index name.
- If you change `modelName` in `OpenAI`, make sure you have access to the api for the appropriate model.
- Make sure you have enough OpenAI credits and a valid card on your billings account.
- Check that you don't have multiple OPENAPI keys in your global environment. If you do, the local `env` file
  from the project will be overwritten by systems `env` variable.
- Try to hard code your API keys into the `process.env` variables if there are still issues.

### Pinecone errors

- Make sure your pinecone dashboard `environment` and `index` matches the one in the `pinecone.ts` and `.env` files.
- Check that you've set the vector dimensions to `1536`.
- Retry from scratch with a new Pinecone project, index, and cloned repo.

## Adding a new site

1. Copy `site-config/config.json` to `site-config/config.[site].json`
2. Edit the new config file with your site's details
3. Write your system prompt in site-config/prompts/[site]-prompt.txt. Be sure above config file references
   the correct prompt for your site.
4. Create .env.[site] and add your site's API keys. Be sure to get a unique GOOGLE_APPLICATION_CREDENTIALS for
   your site.

## Using S3 for Prompts (Optional)

You can store prompt files in AWS S3 instead of the local filesystem. The system will load files:

- With `s3:` prefix from your S3 bucket
- Without prefix from the local filesystem

**Note:** Currently, S3 prompt files are shared between development and production environments. Be cautious
when making changes as they will affect all environments immediately.

1. Configure S3 access in your .env file:

   ```env
   AWS_REGION=us-west-1
   S3_BUCKET_NAME=your-bucket-name
   AWS_ACCESS_KEY_ID=your-access-key
   AWS_SECRET_ACCESS_KEY=your-secret-key
   ```

2. In your site's prompt config (e.g. `site-config/prompts/[site].json`), prefix S3-stored files with `s3:`:

   ```json
   {
     "templates": {
       "baseTemplate": {
         "file": "s3:your-site-base.txt" // Will load from S3
       },
       "localTemplate": {
         "file": "local-file.txt" // Will load from local filesystem
       }
     }
   }
   ```

3. Managing S3 Prompts:

   ```bash
   # Pull a prompt from S3 (and acquire lock)
   npm run prompt [site] pull [filename]

   # Edit the local copy (uses VS Code, $EDITOR, or vim)
   npm run prompt [site] edit [filename]

   # See differences between local and S3 version
   npm run prompt [site] diff [filename]

   # Push changes back to S3 (and release lock)
   npm run prompt [site] push [filename]
   ```

   Example:

   ```bash
   # Full workflow example
   npm run prompt ananda-public pull ananda-public-base.txt
   npm run prompt ananda-public edit ananda-public-base.txt
   npm run prompt ananda-public diff ananda-public-base.txt
   npm run prompt ananda-public push ananda-public-base.txt
   ```

   Features:

   - 5-minute file locking to prevent concurrent edits
   - Automatic versioning through S3 versioning
   - Local staging directory (.prompts-staging)
   - Uses VS Code if available, falls back to $EDITOR or vim
   - Diff command to review changes before pushing

4. Files are stored in the `site-config/prompts/` directory in your S3 bucket

## To activate NPS survey

1. Create a Google Sheet with columns: timestamp, uuid, score, feedback, additionalComments. Rename the tab to "Responses".
2. Add your Google Sheet ID to the .env file as NPS_SURVEY_GOOGLE_SHEET_ID
3. Add your survey frequency in days to the .env file as NPS_SURVEY_FREQUENCY_DAYS
4. Get client email from GOOGLE_APPLICATION_CREDENTIALS in .env file and add it to the Google Sheet as an "editor" user
5. Enable the Google Sheets API in your Google Cloud Console:
   - Go to the Google Cloud Console (<https://console.cloud.google.com/>)
   - Select your project
   - Navigate to "APIs & Services" > "Dashboard"
   - Click on "+ ENABLE APIS AND SERVICES"
   - Search for "Google Sheets API" and enable it
6. Make sure your GOOGLE_APPLICATION_CREDENTIALS in the .env file is correctly set up with the necessary permissions

Note: If you encounter any errors related to Google Sheets API activation, check the backend logs
for specific instructions and follow the provided link to activate the API for your project.

## WordPress Plugin Integration

We provide a WordPress plugin in the `wordpress/plugins/ananda-ai-chatbot` directory
that adds an AI chatbot bubble to your WordPress site. The plugin connects to this
project's chat backend (deployed on Vercel or locally for development).

For detailed installation instructions, features, and development setup, please refer to the [plugin's README file](wordpress/plugins/ananda-ai-chatbot/README.md).
