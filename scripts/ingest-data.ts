import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { OpenAIEmbeddings } from 'langchain/embeddings/openai';
import { PineconeStore } from 'langchain/vectorstores/pinecone';
import { pinecone } from '@/utils/pinecone-client';
import { PINECONE_INDEX_NAME } from '@/config/pinecone';
import { DirectoryLoader } from 'langchain/document_loaders/fs/directory';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { PDFDocument } from "pdf-lib";
import { PDFLoader } from 'langchain/document_loaders/fs/pdf';
import fs from 'fs';
import exiftool from 'node-exiftool';

/* Name of directory to retrieve your files from */
const filePath = 'docs';

// Parse command line arguments
const argv = yargs(hideBin(process.argv)).option('dryrun', {
  type: 'boolean',
  description: 'Run the script without calling Pinecone',
  default: false,
}).argv;

const loadPDFMetadata = async (path) => {
  const pdfBytes = fs.readFileSync(path);
  const PDFdoc = await PDFDocument.load(pdfBytes);

  return {
    title: PDFdoc.getTitle(),
    author: PDFdoc.getAuthor(),
    // Include other metadata fields as needed
  };
};

const extractMetadata = async (pdfFilePath) => {
  const ep = new exiftool.ExiftoolProcess();
  try {
    await ep.open();
    const metadata = await ep.readMetadata(pdfFilePath, ['-File:all']);
    await ep.close();
    if (metadata.data && metadata.data.length > 0) {
      return metadata.data[0]; // Return the first item from the metadata array
    }
    console.error("No metadata found in PDF:", pdfFilePath);
    return {};
  } catch (error) {
    console.error("Error processing PDF:", error);
    return {};
  } finally {
    // Ensure the exiftool process is closed even if an error occurs
    ep.close().catch((error) => console.error("Failed to close exiftool:", error));
  }
};

export const run = async () => {
  try {
    /*load raw docs from the all files in the directory */
    if (!fs.existsSync(filePath)) {
      console.error(`Directory ${filePath} does not exist.`);
      return;
    }
    const directoryLoader = new DirectoryLoader(filePath, {
      '.pdf': async (path) => {
        // Load PDF contents
        const pdfLoader = new PDFLoader(path);
        const content = await pdfLoader.load(); // Assuming PDFLoader has a load() method
      
        // Initialize metadata
        let metadata = null;
      
        // Load PDF metadata using exiftool
        try {
          metadata = await extractMetadata(path);
        } catch (error) {
          console.error("Error extracting metadata:", error);
        }
      
        // Return an object containing both content and metadata
        return {
          path,
          content, 
          metadata, // This will be null if there was an error
        };
      },
    });
    let rawDocs = await directoryLoader.load()
    process.stdout.write('Number of items in rawDocs: ' + rawDocs.length + '\n');

    // Add URL to metadata for each document
    console.log('Adding URL to metadata for each document...');
    // for (const rawDoc of rawDocs) {
    //   const { authors, url } = rawDoc.metadata; // Destructuring to extract authors and URL
    //   console.log('Extracted Authors:', authors);
    //   console.log('Extracted URL:', url);
    
    //   if (rawDoc.metadata) {
    //     rawDoc.metadata.authors = authors;
    //     rawDoc.metadata.url = url;
    //   } else {
    //     rawDoc.metadata = { authors, url };
    //   }
    // }
    for (const rawDoc of rawDocs) {
      console.log("Processing file:", rawDoc.path);
    
      // Access the PDF content
      // const pdfContent = rawDoc.content;
    
      // Access the PDF metadata
      if (rawDoc.metadata) {
        console.log("Extracted Metadata:", rawDoc.metadata);
        // Perform operations with metadata as needed
      } else {
        console.log("No metadata found for:", rawDoc.path);
      }
    }
        
    /* Split text into chunks */
    const textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 200,
    });

    const docs = await textSplitter.splitDocuments(rawDocs);

    if (!argv.dryrun) {
      console.log('creating vector store...');
      /*create and store the embeddings in the vectorStore*/
      const embeddings = new OpenAIEmbeddings();
      const index = pinecone.Index(PINECONE_INDEX_NAME); //change to your own index name

      //embed the PDF documents
      console.log('Embedding the PDF documents...');
      await PineconeStore.fromDocuments(docs, embeddings, {
        pineconeIndex: index,
        textKey: 'text',
      });
      console.log('PDF documents embedded.');
    } else {
      console.log('Dry run mode. Skipping Pinecone call and OpenAI embeddings.');
    }
  } catch (error) {
    console.error('error', error);
    throw new Error('Failed to ingest your data');
  }
};

(async () => {
  console.log('Starting the ingestion process...');
  await run();
  console.log('ingestion complete');
})();
