"""
Unit tests for data_ingestion.utils.text_processing module.

Tests cover all text cleaning and processing functions with various
edge cases, content types, and configuration options.
"""

import pytest
from data_ingestion.utils.text_processing import (
    remove_html_tags,
    replace_smart_quotes,
    clean_document_text,
    normalize_whitespace,
    extract_text_content,
    is_content_meaningful,
    split_into_sentences,
    process_with_preset,
    TEXT_PROCESSING_PRESETS
)


class TestRemoveHtmlTags:
    """Test HTML tag removal functionality."""
    
    def test_basic_html_removal(self):
        """Test removal of basic HTML tags."""
        html = "<p>This is a <strong>test</strong> paragraph.</p>"
        result = remove_html_tags(html)
        assert result == "This is a test paragraph."
    
    def test_complex_html_removal(self):
        """Test removal of complex HTML with nested tags."""
        html = """
        <div class="container">
            <h1>Title</h1>
            <p>Paragraph with <a href="http://example.com">link</a> and <em>emphasis</em>.</p>
            <ul>
                <li>Item 1</li>
                <li>Item 2</li>
            </ul>
        </div>
        """
        result = remove_html_tags(html)
        expected = "Title Paragraph with link and emphasis. Item 1 Item 2"
        assert result == expected
    
    def test_script_and_style_removal(self):
        """Test that script and style elements are completely removed."""
        html = """
        <html>
            <head>
                <style>body { color: red; }</style>
                <script>alert('test');</script>
            </head>
            <body>
                <p>Visible content</p>
                <script>console.log('hidden');</script>
            </body>
        </html>
        """
        result = remove_html_tags(html)
        assert result == "Visible content"
        assert "alert" not in result
        assert "color: red" not in result
        assert "console.log" not in result
    
    def test_empty_input(self):
        """Test handling of empty and None input."""
        assert remove_html_tags("") == ""
        assert remove_html_tags(None) == ""
    
    def test_plain_text(self):
        """Test that plain text without HTML is returned unchanged."""
        text = "This is plain text without any HTML tags."
        result = remove_html_tags(text)
        assert result == text
    
    def test_whitespace_normalization(self):
        """Test that excessive whitespace is normalized."""
        html = "<p>Text   with     lots\n\n\nof    whitespace</p>"
        result = remove_html_tags(html)
        assert result == "Text with lots of whitespace"


class TestReplaceSmartQuotes:
    """Test smart quote and Unicode character replacement."""
    
    def test_single_quotes(self):
        """Test replacement of smart single quotes."""
        text = "It's a \u201csmart\u201d quote test."
        result = replace_smart_quotes(text)
        assert result == "It's a \"smart\" quote test."
    
    def test_double_quotes(self):
        """Test replacement of smart double quotes."""
        text = "\u201cHello,\u201d she said. \u201cHow are you?\u201d"
        result = replace_smart_quotes(text)
        assert result == "\"Hello,\" she said. \"How are you?\""
    
    def test_dashes_and_ellipsis(self):
        """Test replacement of various dashes and ellipsis."""
        text = "A long dash—and an en dash–plus ellipsis…"
        result = replace_smart_quotes(text)
        assert result == "A long dash-and an en dash-plus ellipsis..."
    
    def test_special_spaces_and_symbols(self):
        """Test replacement of non-breaking spaces and other symbols."""
        text = "Non-breaking\u00A0space and bullet\u2022point"
        result = replace_smart_quotes(text)
        assert result == "Non-breaking space and bullet*point"
    
    def test_empty_input(self):
        """Test handling of empty input."""
        assert replace_smart_quotes("") == ""
        assert replace_smart_quotes(None) == ""
    
    def test_mixed_unicode(self):
        """Test text with mixed Unicode characters."""
        text = "Café naïve résumé"  # These should be removed as non-ASCII
        result = replace_smart_quotes(text)
        assert result == "Caf nave rsum"  # Accented characters removed
    
    def test_preserve_basic_ascii(self):
        """Test that basic ASCII text is preserved."""
        text = "Normal ASCII text with punctuation: .,;:!?()[]{}\"'-"
        result = replace_smart_quotes(text)
        assert result == text


class TestCleanDocumentText:
    """Test document-specific text cleaning."""
    
    def test_table_of_contents_dots(self):
        """Test removal of table of contents dot sequences."""
        text = "Chapter 1 . . . . . . . . . . . . . . . . . . . 15"
        result = clean_document_text(text)
        assert result == "Chapter 1 15"
    
    def test_multiple_dot_sequences(self):
        """Test multiple table of contents entries."""
        text = """
        Introduction . . . . . . . . . . . . . . 1
        Chapter 1 . . . . . . . . . . . . . . . . 15
        Chapter 2. . . . . . . . . . . . . . . . . 32
        """
        result = clean_document_text(text)
        lines = result.split('\n')
        assert "Introduction 1" in result
        assert "Chapter 1 15" in result
        assert "Chapter 2 32" in result
        assert "....." not in result
    
    def test_preserve_normal_dots(self):
        """Test that normal periods and ellipsis are preserved."""
        text = "This is a sentence. This has ellipsis... But not dots......."
        result = clean_document_text(text)
        assert "This is a sentence." in result
        assert "This has ellipsis..." in result
        # The long dot sequence should be cleaned
        assert "......." not in result
    
    def test_whitespace_normalization(self):
        """Test normalization of spaces and newlines."""
        text = "Text  with    multiple   spaces\n\n\n\nand\t\ttabs"
        result = clean_document_text(text)
        assert result == "Text with multiple spaces\n\nand tabs"
    
    def test_empty_input(self):
        """Test handling of empty input."""
        assert clean_document_text("") == ""
        assert clean_document_text(None) == None


class TestNormalizeWhitespace:
    """Test whitespace normalization functionality."""
    
    def test_preserve_paragraphs_true(self):
        """Test paragraph preservation mode."""
        text = "Paragraph 1\n\n\n\nParagraph 2\n\n\n\n\nParagraph 3"
        result = normalize_whitespace(text, preserve_paragraphs=True)
        assert result == "Paragraph 1\n\nParagraph 2\n\nParagraph 3"
    
    def test_preserve_paragraphs_false(self):
        """Test paragraph collapse mode."""
        text = "Line 1\n\nLine 2\n\n\nLine 3"
        result = normalize_whitespace(text, preserve_paragraphs=False)
        assert result == "Line 1 Line 2 Line 3"
    
    def test_space_and_tab_normalization(self):
        """Test normalization of spaces and tabs."""
        text = "Word1   \t  Word2\t\t\tWord3"
        result = normalize_whitespace(text)
        assert result == "Word1 Word2 Word3"
    
    def test_empty_input(self):
        """Test handling of empty input."""
        assert normalize_whitespace("") == ""
        assert normalize_whitespace(None) == None


class TestExtractTextContent:
    """Test the main text processing pipeline."""
    
    def test_auto_detection_html(self):
        """Test automatic detection of HTML content."""
        html = "<p>HTML <strong>content</strong> with tags</p>"
        result = extract_text_content(html, content_type="auto")
        assert result == "HTML content with tags"
    
    def test_auto_detection_pdf(self):
        """Test automatic detection of PDF content."""
        pdf_text = "Chapter 1 . . . . . . . . . . . 15\n• Bullet point\nPage 1"
        result = extract_text_content(pdf_text, content_type="auto")
        assert "Chapter 1 15" in result
        assert "Bullet point" in result
    
    def test_auto_detection_plain(self):
        """Test automatic detection of plain text."""
        plain = "Simple plain text without special characters"
        result = extract_text_content(plain, content_type="auto")
        assert result == plain
    
    def test_explicit_html_processing(self):
        """Test explicit HTML content processing."""
        html = '<div>Text with "smart quotes" and <em>emphasis</em></div>'
        result = extract_text_content(html, content_type="html")
        assert result == 'Text with "smart quotes" and emphasis'
    
    def test_explicit_pdf_processing(self):
        """Test explicit PDF content processing."""
        pdf = "Text with \u201csmart quotes\u201d and dots . . . . . . . . 42"
        result = extract_text_content(pdf, content_type="pdf")
        assert result == 'Text with "smart quotes" and dots 42'
    
    def test_preserve_formatting_false(self):
        """Test formatting removal."""
        text = "Paragraph 1\n\nParagraph 2\n\nParagraph 3"
        result = extract_text_content(text, preserve_formatting=False)
        assert result == "Paragraph 1 Paragraph 2 Paragraph 3"
    
    def test_empty_input(self):
        """Test handling of empty input."""
        assert extract_text_content("") == ""
        assert extract_text_content(None) == ""


class TestIsContentMeaningful:
    """Test content meaningfulness evaluation."""
    
    def test_meaningful_content(self):
        """Test detection of meaningful content."""
        text = "This is meaningful content with sufficient length."
        assert is_content_meaningful(text) == True
    
    def test_short_content(self):
        """Test rejection of too-short content."""
        text = "Short"
        assert is_content_meaningful(text, min_length=10) == False
    
    def test_whitespace_only(self):
        """Test rejection of whitespace-only content."""
        text = "   \n\n\t   "
        assert is_content_meaningful(text) == False
    
    def test_punctuation_only(self):
        """Test rejection of punctuation-only content."""
        text = "... --- *** ((()))"
        assert is_content_meaningful(text) == False
    
    def test_empty_input(self):
        """Test handling of empty input."""
        assert is_content_meaningful("") == False
        assert is_content_meaningful(None) == False
    
    def test_custom_min_length(self):
        """Test custom minimum length threshold."""
        text = "Medium"
        assert is_content_meaningful(text, min_length=5) == True
        assert is_content_meaningful(text, min_length=10) == False


class TestSplitIntoSentences:
    """Test sentence splitting functionality."""
    
    def test_basic_sentence_splitting(self):
        """Test basic sentence splitting on periods."""
        text = "First sentence. Second sentence. Third sentence."
        result = split_into_sentences(text)
        assert result == ["First sentence.", "Second sentence.", "Third sentence."]
    
    def test_multiple_punctuation(self):
        """Test splitting on various punctuation marks."""
        text = "Question? Exclamation! Another sentence."
        result = split_into_sentences(text)
        assert result == ["Question?", "Exclamation!", "Another sentence."]
    
    def test_multiple_punctuation_marks(self):
        """Test handling of multiple consecutive punctuation marks."""
        text = "Really?! Yes... Maybe."
        result = split_into_sentences(text)
        assert len(result) >= 2  # Should split appropriately
    
    def test_empty_input(self):
        """Test handling of empty input."""
        assert split_into_sentences("") == []
        assert split_into_sentences(None) == []
    
    def test_no_sentence_endings(self):
        """Test text without sentence-ending punctuation."""
        text = "Text without proper endings"
        result = split_into_sentences(text)
        assert result == ["Text without proper endings"]


class TestProcessWithPreset:
    """Test preset-based text processing."""
    
    def test_pdf_document_preset(self):
        """Test PDF document processing preset."""
        text = "Chapter 1 . . . . . . . 15\nContent with \u201csmart quotes\u201d"
        result = process_with_preset(text, "pdf_document")
        assert "Chapter 1 15" in result
        assert '"smart quotes"' in result
    
    def test_web_content_preset(self):
        """Test web content processing preset."""
        html = "<p>Web content with <strong>HTML</strong> tags</p>"
        result = process_with_preset(html, "web_content")
        assert result == "Web content with HTML tags"
    
    def test_database_field_preset(self):
        """Test database field processing preset."""
        text = '<div>Database content with "quotes" & symbols</div>'
        result = process_with_preset(text, "database_field")
        # Should remove HTML tags and normalize formatting
        assert "Database content" in result
        assert "<div>" not in result
        assert "quotes" in result  # Should preserve quotes and symbols
    
    def test_minimal_clean_preset(self):
        """Test minimal cleaning preset."""
        text = "Text with \u201csmart quotes\u201d but no HTML"
        result = process_with_preset(text, "minimal_clean")
        assert result == 'Text with "smart quotes" but no HTML'
    
    def test_invalid_preset(self):
        """Test error handling for invalid preset."""
        with pytest.raises(ValueError) as exc_info:
            process_with_preset("text", "nonexistent_preset")
        assert "Unknown preset" in str(exc_info.value)
        assert "Available presets:" in str(exc_info.value)
    
    def test_all_presets_exist(self):
        """Test that all documented presets actually exist."""
        expected_presets = ["pdf_document", "web_content", "database_field", "minimal_clean"]
        for preset in expected_presets:
            assert preset in TEXT_PROCESSING_PRESETS
            # Should not raise an error
            result = process_with_preset("test text", preset)
            assert isinstance(result, str)


class TestIntegration:
    """Integration tests combining multiple functions."""
    
    def test_full_html_processing_pipeline(self):
        """Test complete HTML processing pipeline."""
        html = """
        <html>
            <head><title>Test</title></head>
            <body>
                <h1>Title with \u201csmart quotes\u201d</h1>
                <p>Paragraph with <strong>bold</strong> text.</p>
                <script>alert('remove me');</script>
            </body>
        </html>
        """
        result = extract_text_content(html, content_type="html")
        
        # Should remove HTML tags
        assert "<" not in result and ">" not in result
        # Should normalize smart quotes  
        assert '"smart quotes"' in result
        # Should remove script content
        assert "alert" not in result
        # Should preserve meaningful content
        assert "Title" in result and "Paragraph" in result
    
    def test_full_pdf_processing_pipeline(self):
        """Test complete PDF processing pipeline."""
        pdf_text = """
        Table of Contents
        
        Chapter 1 . . . . . . . . . . . . . . . . . 15
        Chapter 2. . . . . . . . . . . . . . . . . . 32
        
        
        
        Main content with \u201csmart quotes\u201d and proper text.
        
        
        Another paragraph here.
        """
        result = extract_text_content(pdf_text, content_type="pdf")
        
        # Should clean table of contents dots
        assert "....." not in result
        assert "Chapter 1 15" in result
        # Should normalize smart quotes
        assert '"smart quotes"' in result
        # Should preserve paragraph structure
        assert "\n\n" in result
        # Should normalize excessive newlines
        assert "\n\n\n" not in result
    
    def test_edge_cases_combined(self):
        """Test various edge cases in combination."""
        problematic_text = ""
        result = extract_text_content(problematic_text)
        assert result == ""
        
        # Test None input
        result = extract_text_content(None)
        assert result == ""
        
        # Test very long dots
        dots_text = "Chapter" + "." * 50 + "Page 1"
        result = extract_text_content(dots_text, content_type="pdf")
        assert "Chapter Page 1" in result
        assert "....." not in result 