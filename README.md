# Ask Ananda Library - A RAG Chatbot for Your PDF Files, Audio Files, and YouTube Videos

Build a chatGPT chatbot for multiple Large PDF files, audio files, and YouTube videos. Optionally generate the PDF fileset from a Wordpress database. Transcribe mp3 files en masse. Download YouTube videos en masse and transcribe their audio. Allow users to share the best answers they get with each other through a social, sharing interface.

Audio and video results are shown inline with a player queued to the moment matched in the transcript.

Tech stack used includes LangChain, Pinecone, Typescript, Openai, Next.js, Google Firestore, AWS, and Python. LangChain is a framework that makes it easier to build scalable AI/LLM apps and chatbots. Pinecone is a vectorstore for storing embeddings to later retrieve similar docs.

[Tutorial video from project we forked from](https://www.youtube.com/watch?v=ih9PBGVVOO4)

The visual guide of this repo and tutorial is in the `visual guide` folder.

**If you run into errors, please review the troubleshooting section further down this page.**

Prelude: Please make sure you have already downloaded node on your system and the version is 18 or greater.

## Forked Version

This is a fork of gpt4-pdf-chatbot-langchain. This version looks for a specified source in the Subject metadata of the PDF file.

## Generate PDF's to use from Wordpress MySQL database

For the Ananda Library, we have provided code that can take a wordpress MySQL database and generate PDF files for all of the published content. For us, that is about 7,000 documents.

700 Audio files and 800+ YouTube videos.

## Enhanced Frontend with Social Media Sharing

The runtime website code is significantly extended from the forked project. We have added

- Display of sources with links and inline audio/video players
- Thumbs up for social feedback and thumbs down for system feedback
- Copy button
- All Answers page for social sharing
- Dedicate page for an answer
- Related questions

## Development

1. Clone the repo or download the ZIP

    git clone [github https url]

1. Install packages

First run `npm install yarn -g` to install yarn globally (if you haven't already).

Then run:

    yarn install

After installation, you should now see a `node_modules` folder.

1. Set up your `.env` file

- Copy `.env.example` into `.env`
  Your `.env` file should look like this:

    OPENAI_API_KEY=
    PINECONE_API_KEY=
    PINECONE_INDEX_NAME=

- Visit [openai](https://help.openai.com/en/articles/4936850-where-do-i-find-my-secret-api-key) to retrieve API keys and insert into your `.env` file.
- Visit [pinecone](https://pinecone.io/) to create and retrieve your API keys, and also retrieve your environment and index name from the dashboard. Be sure to use 1,536 as dimensions when setting up your pinecone index.
- Visit [upstash](https://upstash.com/) to create an upstash function to cache keywords for related questions.

1. In the `config` folder, replace the `PINECONE_NAME_SPACE` with a `namespace` where you'd like to store your embeddings on Pinecone when you run `npm run ingest`. This namespace will later be used for queries and retrieval.

1. In `utils/makechain.ts` chain change the `QA_PROMPT` for your own usecase. Change `modelName` in `new OpenAI` to `gpt-4`, if you have access to `gpt-4` api. Please verify outside this repo that you have access to `gpt-4` api, otherwise the application will not work.

### Setup Firebase

We use firestore local emulation in dev. Mac users, be sure to install via brew install firebase-cli

Add to your environment (e.g., .bashrc):
`export FIRESTORE_EMULATOR_HOST="127.0.0.1:8080”`

Command line:

1. firebase login
2. firebase init emulators
3. npm run emulator

### Setup python virtual environment

Create a virtual environment with pyenv

```
pyenv virtualenv 3.12.3 ananda-library-chatbot
```

Activate it automatically when you enter the directory:

```
pyenv local ananda-library-chatbot
```

## Optional: generate PDF files from Wordpress Database

First, you need to import a MySQL data dump from wordpress into local MySQL (or set up access to the DB).

Second, you run *python data-ingestion/ananda-doc-gen/db-to-pdfs.py* from the `data-ingestion/ananda-doc-gen/` directory to generate PDF files.

Third, you optionally run *python data-ingestion/ananda-doc-gen/filter-pdfs-to-new-dir.py* from the same directory to get just a subset of the PDFs, e.g., just swami and master.

Fourth, put the file set you want in `doc/` and make sure the Pinecone index is empty.

## Convert your PDF files to embeddings

This repo can load multiple PDF files.

1. Inside `docs` folder, add your pdf files or folders that contain pdf files.

1. Run the script `yarn run ingest` to 'ingest' and embed your docs. If you run into errors troubleshoot below.

You can add arguments like this:
yarn run ingest -- --dryrun

1. Check Pinecone dashboard to verify your namespace and vectors have been added.

## Transcribe MP3 files and YouTube videos and convert to embeddings

Put your MP3 files in `data-ingestion/media/`, in subfolders. Create a list of YouTube videos or playlists.

Run `python data-ingestion/scripts/transcribe-and-ingest-media.py` to transcribe and embed your audio files and YouTube videos!

## Run the app

Once you've verified that the embeddings and content have been successfully added to your Pinecone, you can run the app `npm run dev` to launch the local dev environment, and then type a question in the chat interface.

## Troubleshooting

In general, keep an eye out in the `issues` and `discussions` section of this repo for solutions.

### General errors

- Make sure you're running the latest Node version. Run `node -v`
- Try a different PDF or convert your PDF to text first. It's possible your PDF is corrupted, scanned, or requires OCR to convert to text.
- `Console.log` the `env` variables and make sure they are exposed.
- Make sure you're using the same versions of LangChain and Pinecone as this repo.
- Check that you've created an `.env` file that contains your valid (and working) API keys, environment and index name.
- If you change `modelName` in `OpenAI`, make sure you have access to the api for the appropriate model.
- Make sure you have enough OpenAI credits and a valid card on your billings account.
- Check that you don't have multiple OPENAPI keys in your global environment. If you do, the local `env` file from the project will be overwritten by systems `env` variable.
- Try to hard code your API keys into the `process.env` variables if there are still issues.

### Pinecone errors

- Make sure your pinecone dashboard `environment` and `index` matches the one in the `pinecone.ts` and `.env` files.
- Check that you've set the vector dimensions to `1536`.
- Make sure your pinecone namespace is in lowercase.
- Pinecone indexes of users on the Starter(free) plan are deleted after 7 days of inactivity. To prevent this, send an API request to Pinecone to reset the counter before 7 days.
- Retry from scratch with a new Pinecone project, index, and cloned repo.

## Credit

Frontend of this repo is inspired by [langchain-chat-nextjs](https://github.com/zahidkhawaja/langchain-chat-nextjs)