"""
Utility module for text splitting using spaCy.
This module provides a reusable SpacyTextSplitter class that can be used
across different data ingestion scripts to ensure consistent chunking behavior.
"""

import logging
import spacy
from typing import List, Dict, Any

# Configure logging
logger = logging.getLogger(__name__)

# Define Document class to avoid circular imports
class Document:
    """Simple document class with content and metadata"""
    
    def __init__(self, page_content: str, metadata: Dict[str, Any] = None):
        self.page_content = page_content
        self.metadata = metadata or {}

class SpacyTextSplitter:
    """Text splitter that uses spaCy to split text into chunks by paragraphs."""
    
    def __init__(self, chunk_size=600, chunk_overlap=120, separator="\n\n", pipeline="en_core_web_sm"):
        """
        Initialize the SpacyTextSplitter.
        
        Args:
            chunk_size (int): Maximum size of chunks to return
            chunk_overlap (int): Overlap in characters between chunks
            separator (str): Separator to use for splitting text
            pipeline (str): Name of spaCy pipeline/model to use
        
        Raises:
            ValueError: If chunk_size, chunk_overlap are invalid
        """
        if chunk_size <= 0:
            raise ValueError("chunk_size must be positive")
        if chunk_overlap < 0:
            raise ValueError("chunk_overlap must be non-negative")
        if chunk_overlap >= chunk_size:
            raise ValueError("chunk_overlap must be smaller than chunk_size")
        
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap
        self.separator = separator
        self.pipeline = pipeline
        self.nlp = None
        self.logger = logging.getLogger(f"{__name__}.SpacyTextSplitter")
    
    def _ensure_nlp(self):
        """
        Ensure spaCy model is loaded, downloading if necessary.
        
        Raises:
            RuntimeError: If the model couldn't be loaded or downloaded
        """
        if self.nlp is None:
            try:
                self.logger.debug(f"Loading spaCy model {self.pipeline}")
                self.nlp = spacy.load(self.pipeline)
            except OSError:
                try:
                    self.logger.info(f"Downloading spaCy model {self.pipeline}...")
                    spacy.cli.download(self.pipeline)
                    self.nlp = spacy.load(self.pipeline)
                    self.logger.info(f"Successfully downloaded and loaded {self.pipeline}")
                except Exception as e:
                    error_msg = f"Failed to download spaCy model {self.pipeline}: {str(e)}"
                    self.logger.error(error_msg)
                    raise RuntimeError(error_msg) from e
            except Exception as e:
                error_msg = f"Error loading spaCy model {self.pipeline}: {str(e)}"
                self.logger.error(error_msg)
                raise RuntimeError(error_msg) from e
                
    def split_text(self, text: str) -> List[str]:
        """
        Split text into chunks using spaCy.
        
        Args:
            text (str): The text to split
            
        Returns:
            List[str]: A list of text chunks
            
        Raises:
            ValueError: If the input text is not a string
            RuntimeError: If there's an error processing the text
        """
        if not isinstance(text, str):
            error_msg = f"Expected string input, got {type(text)}"
            self.logger.error(error_msg)
            raise ValueError(error_msg)
        
        try:
            self._ensure_nlp()
            
            # If text is empty, return empty list
            if not text.strip():
                return []
            
            chunks = []
            
            # First split by separator - these are our primary chunk boundaries
            if self.separator:
                initial_splits = text.split(self.separator)
                self.logger.debug(f"Split text into {len(initial_splits)} parts using separator '{self.separator}'")
            else:
                initial_splits = [text]
            
            for split_text in initial_splits:
                split_text = split_text.strip()
                if not split_text:
                    continue
                    
                # If the split is longer than chunk_size, break it down further with spaCy
                if len(split_text) > self.chunk_size:
                    try:
                        # Process with spaCy for sentence-based splitting
                        doc = self.nlp(split_text)
                        
                        current_chunk = []
                        current_size = 0
                        
                        for sent in doc.sents:
                            sent_text = sent.text.strip()
                            if not sent_text:
                                continue
                                
                            # If a single sentence is longer than chunk_size, keep it as its own chunk
                            if len(sent_text) > self.chunk_size:
                                # If we have accumulated text, add it as a chunk first
                                if current_chunk:
                                    chunks.append(" ".join(current_chunk))
                                    current_chunk = []
                                    current_size = 0
                                # Add the long sentence as its own chunk
                                chunks.append(sent_text)
                                self.logger.debug(f"Added long sentence as chunk: {len(sent_text)} chars")
                            # If adding this sentence would exceed chunk_size, start a new chunk
                            elif current_size + len(sent_text) + (1 if current_chunk else 0) > self.chunk_size:
                                chunks.append(" ".join(current_chunk))
                                self.logger.debug(f"Created chunk of size {current_size} chars")
                                current_chunk = [sent_text]
                                current_size = len(sent_text)
                            # Otherwise, add to current chunk
                            else:
                                current_chunk.append(sent_text)
                                current_size += len(sent_text) + (1 if current_chunk else 0)
                        
                        # Add any remaining text in the current chunk
                        if current_chunk:
                            chunks.append(" ".join(current_chunk))
                            self.logger.debug(f"Added final sentence chunk of size {current_size} chars")
                    except Exception as e:
                        error_msg = f"Error processing text with spaCy: {str(e)}"
                        self.logger.error(error_msg)
                        raise RuntimeError(error_msg) from e
                else:
                    # If the split is smaller than chunk_size, add it directly
                    chunks.append(split_text)
                    self.logger.debug(f"Added small split as chunk: {len(split_text)} chars")
            
            # Apply chunk overlap - but only for certain types of splits
            # For paragraph separators (\n\n), we want to maintain clean boundaries
            skip_overlap = self.separator == "\n\n"  # Only skip overlap for paragraph separators
            
            if self.chunk_overlap > 0 and len(chunks) > 1 and not skip_overlap:
                try:
                    result = []
                    result.append(chunks[0])
                    
                    for i in range(1, len(chunks)):
                        prev_chunk = chunks[i-1]
                        current_chunk = chunks[i]
                        
                        # Get overlap text from end of previous chunk
                        overlap_size = min(self.chunk_overlap, len(prev_chunk))
                        overlap_text = prev_chunk[-overlap_size:]
                        
                        # Add overlap to current chunk if it doesn't already start with it
                        if not current_chunk.startswith(overlap_text):
                            current_chunk = overlap_text + current_chunk
                            self.logger.debug(f"Applied overlap of {overlap_size} chars between chunks")
                        
                        result.append(current_chunk)
                    
                    self.logger.info(f"Split text into {len(result)} chunks with overlap")
                    return result
                except Exception as e:
                    error_msg = f"Error applying chunk overlap: {str(e)}"
                    self.logger.error(error_msg)
                    raise RuntimeError(error_msg) from e
            
            self.logger.info(f"Split text into {len(chunks)} chunks without overlap")
            return chunks
        except Exception as e:
            if isinstance(e, (ValueError, RuntimeError)):
                raise
            error_msg = f"Unexpected error in split_text: {str(e)}"
            self.logger.error(error_msg)
            raise RuntimeError(error_msg) from e
    
    def split_documents(self, documents: List[Document]) -> List[Document]:
        """
        Split documents into chunks.
        
        Args:
            documents (List[Document]): The documents to split
            
        Returns:
            List[Document]: A list of chunked documents
            
        Raises:
            ValueError: If the input is not a list of Document objects
            RuntimeError: If there's an error processing the documents
        """
        if not isinstance(documents, list):
            error_msg = f"Expected list of documents, got {type(documents)}"
            self.logger.error(error_msg)
            raise ValueError(error_msg)
        
        try:
            chunked_docs = []
            
            for doc in documents:
                if not isinstance(doc, Document):
                    error_msg = f"Expected Document object, got {type(doc)}"
                    self.logger.error(error_msg)
                    raise ValueError(error_msg)
                
                text = doc.page_content
                chunks = self.split_text(text)
                
                for chunk in chunks:
                    if chunk:
                        chunked_docs.append(Document(
                            page_content=chunk,
                            metadata=doc.metadata.copy()
                        ))
                        
            self.logger.info(f"Split {len(documents)} documents into {len(chunked_docs)} chunks")
            return chunked_docs
        except Exception as e:
            if isinstance(e, (ValueError, RuntimeError)):
                raise
            error_msg = f"Unexpected error in split_documents: {str(e)}"
            self.logger.error(error_msg)
            raise RuntimeError(error_msg) from e 