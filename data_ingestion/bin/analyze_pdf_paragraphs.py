import sys

import PyPDF2

if len(sys.argv) < 2:
    print("Please provide a PDF filename as argument")
    sys.exit(1)

filename = sys.argv[1]

with open(filename, "rb") as file:
    reader = PyPDF2.PdfReader(file)
    text = "".join(page.extract_text() or "" for page in reader.pages)
    print("Double Newlines: " + str(text.count("\n\n")))
    print("Single Newlines: " + str(text.count("\n") - 2 * text.count("\n\n")))
    print(f"Sample: {text[:500]}...")
