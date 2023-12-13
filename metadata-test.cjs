const fs = require('fs');
const exiftool = require('node-exiftool');

async function extractMetadata(pdfFilePath) {
    try {
        const ep = new exiftool.ExiftoolProcess();

        ep.open()
          .then((pid) => console.log('Started exiftool process %s', pid))
          .then(() => ep.readMetadata(pdfFilePath, ['-File:all']))
          .then((result) => {
              console.log("Metadata of the PDF:", result);
              return ep.close();
          })
          .then(() => console.log('Closed exiftool'))
          .catch(console.error);
        
    } catch (error) {
        console.error("Error processing PDF:", error);
    }
}

// Check if a PDF file is provided as a command line argument
if (process.argv.length < 3) {
    console.log("Please provide a PDF file as an argument.");
    process.exit(1);
}

// Extract the PDF file path from the command line arguments
const pdfFilePath = process.argv[2];

// Call the function
extractMetadata(pdfFilePath);
