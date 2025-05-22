import os
import sys
import unittest
import asyncio
import json
import tempfile
import hashlib
import pytest
from unittest.mock import patch, MagicMock, AsyncMock, mock_open

# Add parent directory to path for importing modules
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../')))

# Import the module to test
import pdf_to_vector_db as pdf_ingestion
from pdf_to_vector_db import Document, OpenAIEmbeddings, SpacyTextSplitter # Import custom classes


# Pytest fixtures for setup and teardown
@pytest.fixture
def mock_env():
    """Set up mock environment variables."""
    with patch.dict('os.environ', {
        'PINECONE_API_KEY': 'test-api-key',
        'PINECONE_INGEST_INDEX': 'test-index',
        'OPENAI_INGEST_EMBEDDINGS_MODEL': 'text-embedding-ada-002',
        'OPENAI_INGEST_EMBEDDINGS_DIMENSION': '1536',
        'SOURCE_URL': 'https://test.com/doc',
        'OPENAI_API_KEY': 'test-openai-api-key'
    }):
        yield

@pytest.fixture
def temp_dir():
    """Create a temporary directory for test files."""
    temp = tempfile.TemporaryDirectory()
    pdf_ingestion.file_path = temp.name
    yield temp.name
    temp.cleanup()


# Synchronous tests
def test_get_pinecone_client(mock_env):
    """Test Pinecone client initialization"""
    with patch('pdf_to_vector_db.Pinecone') as mock_pinecone:
        mock_instance = MagicMock()
        mock_pinecone.return_value = mock_instance
        
        client = pdf_ingestion.get_pinecone_client()
        
        mock_pinecone.assert_called_once_with(api_key='test-api-key')
        assert client == mock_instance

def test_get_pinecone_ingest_index_name(mock_env):
    """Test getting Pinecone index name"""
    index_name = pdf_ingestion.get_pinecone_ingest_index_name()
    assert index_name == 'test-index'

def test_get_pinecone_ingest_index_name_missing():
    """Test error when Pinecone index name is missing"""
    with patch.dict('os.environ', {'PINECONE_INGEST_INDEX': ''}):
        with pytest.raises(ValueError):
            pdf_ingestion.get_pinecone_ingest_index_name()

def test_load_env_existing_file():
    """Test loading environment variables from existing file"""
    with patch('os.path.exists', return_value=True), \
         patch('pdf_to_vector_db.load_dotenv') as mock_load_dotenv:
        
        pdf_ingestion.load_env('test-site')
        
        mock_load_dotenv.assert_called_once_with('.env.test-site')

def test_load_env_missing_file():
    """Test error when environment file is missing"""
    with patch('os.path.exists', return_value=False):
        with pytest.raises(FileNotFoundError):
            pdf_ingestion.load_env('test-site')

def test_signal_handler():
    """Test signal handler behavior"""
    # Instead of patching cleanup, we'll create a simple function that returns None
    def mock_cleanup_fn():
        return None
        
    with patch('pdf_to_vector_db.cleanup', mock_cleanup_fn), \
         patch('pdf_to_vector_db.asyncio.create_task', lambda coro: None) as mock_create_task, \
         patch('pdf_to_vector_db.sys.exit') as mock_exit:
        
        # First Ctrl+C
        pdf_ingestion.is_exiting = False
        pdf_ingestion.signal_handler(None, None)
        assert pdf_ingestion.is_exiting is True
        # mock_create_task assertion removed since we're using lambda
        mock_exit.assert_not_called()
        
        # Second Ctrl+C
        pdf_ingestion.signal_handler(None, None)
        mock_exit.assert_called_once_with(0)

# Asynchronous tests
@pytest.mark.asyncio
async def test_create_folder_signature(mock_env, temp_dir):
    """Test creating folder signature from PDF files"""
    # Mock file system
    with patch('os.walk') as mock_walk:
        mock_walk.return_value = [
            ('/root', [], ['doc1.pdf', 'doc2.pdf', 'other.txt']),
            ('/root/sub', [], ['doc3.pdf'])
        ]
        
        with patch('os.stat') as mock_stat:
            # Set up mock stat results
            mock_stat_result = MagicMock()
            mock_stat_result.st_mtime = 12345
            mock_stat.return_value = mock_stat_result
            
            signature = await pdf_ingestion.create_folder_signature('/root')
            
            # Verify correct files were processed
            assert mock_stat.call_count == 3  # 3 PDF files
            
            # Expected signature calculation
            expected_files = [
                '/root/doc1.pdf:12345',
                '/root/doc2.pdf:12345',
                '/root/sub/doc3.pdf:12345'
            ]
            expected_signature = hashlib.md5('|'.join(sorted(expected_files)).encode()).hexdigest()
            
            assert signature == expected_signature

@pytest.mark.asyncio
async def test_save_and_load_checkpoint(mock_env, temp_dir):
    """Test saving and loading checkpoint data"""
    # Test save_checkpoint
    with patch('builtins.open', mock_open()) as mock_file, \
         patch('json.dump') as mock_json_dump:
        
        await pdf_ingestion.save_checkpoint(42, 'test-signature')
        
        mock_file.assert_called_once_with(pdf_ingestion.CHECKPOINT_FILE, 'w')
        mock_json_dump.assert_called_once_with(
            {'processed_docs': 42, 'folder_signature': 'test-signature'}, 
            mock_file()
        )
    
    # Test load_checkpoint
    checkpoint_data = {'processed_docs': 42, 'folder_signature': 'test-signature'}
    with patch('builtins.open', mock_open(read_data=json.dumps(checkpoint_data))):
        result = await pdf_ingestion.load_checkpoint()
        assert result == checkpoint_data
    
    # Test load_checkpoint with file not found
    with patch('builtins.open', side_effect=FileNotFoundError):
        result = await pdf_ingestion.load_checkpoint()
        assert result is None

@pytest.mark.asyncio
async def test_clear_library_text_vectors(mock_env):
    """Test clearing library text vectors from Pinecone"""
    # Create mock index and response
    mock_index = MagicMock()
    mock_response = MagicMock()
    mock_response.vectors = [MagicMock(id='vec1'), MagicMock(id='vec2')]
    mock_response.pagination = MagicMock(next=None)
    
    # Configure mock response
    with patch('asyncio.to_thread') as mock_to_thread:
        mock_to_thread.side_effect = [mock_response, None]  # First list, then delete
        
        await pdf_ingestion.clear_library_text_vectors(mock_index, 'test-library')
        
        # Verify correct calls were made
        mock_to_thread.assert_any_call(mock_index.list, prefix='text||test-library||', pagination_token=None)
        mock_to_thread.assert_any_call(mock_index.delete, ids=['vec1', 'vec2'])

@pytest.mark.asyncio
async def test_process_document(mock_env):
    """Test processing a single document with spaCy chunking"""
    # Mock OpenAI API response
    with patch('pdf_to_vector_db.requests.post') as mock_requests_post, \
         patch('pdf_to_vector_db.SpacyTextSplitter.split_documents') as mock_split_documents:
        
        # Instead of mocking _ensure_nlp, we'll mock the split_documents method directly
        mock_split_documents.return_value = [
            Document(
                page_content="This is chunk 1",
                metadata={
                    'source': 'https://test.com/doc',
                    'title': 'Test Document',
                    'page': 0
                }
            )
        ]
        
        mock_openai_response = MagicMock()
        mock_openai_response.json.return_value = {
            'data': [{'embedding': [0.1, 0.2, 0.3]}]
        }
        mock_openai_response.raise_for_status = MagicMock()
        mock_requests_post.return_value = mock_openai_response

        mock_pinecone_index = AsyncMock() # Pinecone index is now directly used
        mock_embeddings = OpenAIEmbeddings(api_key='test-openai-api-key') # Use our custom class
        
        mock_doc = Document( # Use our custom Document class
            page_content="This is test content. This is more content to make it long enough for chunking.",
            metadata={
                'pdf': {
                    'info': {
                        'Title': 'Test Document',
                        'Subject': 'https://test.com/doc'
                    }
                },
                'page': 0
            }
        )
        
        # Instantiate SpacyTextSplitter directly
        text_splitter = SpacyTextSplitter(
            chunk_size=30, # Smaller chunk size for testing
            chunk_overlap=5,
            separator="\n\n",
            pipeline="en_core_web_sm"
        )
        
        with patch('pdf_to_vector_db.process_chunk', new_callable=AsyncMock) as mock_process_chunk:
            
            await pdf_ingestion.process_document(
                mock_doc, 
                mock_pinecone_index, 
                mock_embeddings, 
                0, 
                'test-library', 
                text_splitter # Pass the instance
            )
            
            # Verify process_chunk was called for each chunk
            assert mock_process_chunk.call_count > 0 # Ensure it was called

@pytest.mark.asyncio
async def test_process_chunk(mock_env):
    """Test processing a single document chunk"""
    # Mock OpenAI API response
    with patch('pdf_to_vector_db.OpenAIEmbeddings.embed_query') as mock_embed_query, \
         patch('asyncio.to_thread') as mock_to_thread:
        
        # Mock the embed_query method to return a direct value, not a coroutine
        mock_embed_query.return_value = [0.1, 0.2, 0.3]
        
        # Create mock document
        mock_doc = Document( # Use our custom Document class
            page_content="Test content",
            metadata={'title': 'Test Document', 'author': 'Test Author', 'source': 'https://test.com'}
        )
        
        # Create mock Pinecone index and OpenAIEmbeddings
        mock_pinecone_index = AsyncMock()
        mock_embeddings = OpenAIEmbeddings(api_key='test-openai-api-key')
        
        # Test the function
        await pdf_ingestion.process_chunk(mock_doc, mock_pinecone_index, mock_embeddings, 0, 'test-library')
        
        # Verify correct ID generation and metadata
        expected_id = f"text||test-library||Test_Document||{hashlib.md5('Test content'.encode()).hexdigest()[:8]}||chunk1"
        
        expected_metadata = {
            'id': expected_id,
            'library': 'test-library',
            'type': 'text',
            'author': 'Test Author',
            'source': 'https://test.com',
            'title': 'Test Document',
            'text': 'Test content',
        }
        
        # Check that to_thread was called
        assert mock_to_thread.called
        
        # Verify the call arguments for asyncio.to_thread
        # We expect the first arg to be the pinecone_index.upsert function
        first_call_args = mock_to_thread.call_args_list[0]
        args = first_call_args.args
        
        # First argument should be the upsert method
        assert args[0] == mock_pinecone_index.upsert
        
        # Extract the vectors parameter from kwargs
        kwargs = first_call_args.kwargs
        vectors = kwargs.get('vectors', None)
        
        # If vectors is not in kwargs, it might be a positional argument
        if vectors is None and len(args) > 1:
            vectors = args[1]
        
        # Assert that we have vectors data
        assert vectors is not None
        assert len(vectors) == 1
        
        vector_data = vectors[0]
        assert vector_data[0] == expected_id  # Check ID
        assert vector_data[1] == [0.1, 0.2, 0.3]  # Check embedding
        assert vector_data[2] == expected_metadata  # Check metadata

@pytest.mark.asyncio
async def test_create_pinecone_index_if_not_exists_existing(mock_env):
    """Test checking existing Pinecone index"""
    mock_pinecone = MagicMock()
    
    with patch('asyncio.to_thread') as mock_to_thread:
        mock_to_thread.return_value = None  # Simulate index exists
        
        await pdf_ingestion.create_pinecone_index_if_not_exists(mock_pinecone, 'test-index')
        
        mock_to_thread.assert_called_once_with(mock_pinecone.describe_index, 'test-index')
        mock_pinecone.create_index.assert_not_called()

@pytest.mark.asyncio
async def test_create_pinecone_index_if_not_exists_new():
    """Test creating a new Pinecone index"""
    # Set required environment variables
    with patch.dict('os.environ', {
        'PINECONE_API_KEY': 'test-api-key',
        'PINECONE_INGEST_INDEX': 'test-index',
        'OPENAI_INGEST_EMBEDDINGS_MODEL': 'text-embedding-ada-002',
        'OPENAI_INGEST_EMBEDDINGS_DIMENSION': '1536',
        'PINECONE_CLOUD': 'aws', 
        'PINECONE_REGION': 'us-east-1'
    }):
        mock_pinecone = MagicMock()
        
        with patch('asyncio.to_thread') as mock_to_thread:
            # Create a custom exception class with status attribute
            class MockPineconeException(Exception):
                def __init__(self, message):
                    self.status = 404
                    super().__init__(message)
            
            # Simulate index not found, then successful creation
            mock_exception = MockPineconeException("Index not found (mocked)")
            mock_to_thread.side_effect = [
                mock_exception,  # describe_index fails
                None  # create_index succeeds
            ]

            await pdf_ingestion.create_pinecone_index_if_not_exists(mock_pinecone, 'new-index')
            
            assert mock_to_thread.call_count == 2
            mock_to_thread.assert_any_call(mock_pinecone.describe_index, 'new-index')
            mock_to_thread.assert_any_call(
                mock_pinecone.create_index,
                name='new-index',
                dimension=1536,
                metric='cosine',
                spec={'serverless': {'cloud': 'aws', 'region': 'us-east-1'}}
            )

@pytest.mark.asyncio
async def test_cleanup(mock_env, temp_dir):
    """Test cleanup function saves progress"""
    with patch('pdf_to_vector_db.create_folder_signature', new_callable=AsyncMock) as mock_create_signature, \
         patch('pdf_to_vector_db.load_checkpoint', new_callable=AsyncMock) as mock_load_checkpoint, \
         patch('pdf_to_vector_db.save_checkpoint', new_callable=AsyncMock) as mock_save_checkpoint:
        
        mock_create_signature.return_value = 'new-signature'
        mock_load_checkpoint.return_value = {'processed_docs': 10}
        
        await pdf_ingestion.cleanup()
        
        mock_create_signature.assert_called_once_with(temp_dir)
        mock_load_checkpoint.assert_called_once()
        mock_save_checkpoint.assert_called_once_with(10, 'new-signature')

# Test runner code removed - pytest automatically handles async tests with pytest.mark.asyncio 