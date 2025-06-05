"""
Unit tests for data_ingestion.utils.text_processing module.

Tests cover all text cleaning and processing functions with various
edge cases, content types, and configuration options.
"""

import pytest

from data_ingestion.utils.text_processing import (
    TEXT_PROCESSING_PRESETS,
    clean_document_text,
    extract_text_content,
    is_content_meaningful,
    normalize_whitespace,
    process_with_preset,
    remove_html_tags,
    replace_smart_quotes,
    split_into_sentences,
)


class TestRemoveHtmlTags:
    """Test HTML tag removal functionality."""

    def test_basic_html_removal(self):
        """Test removal of basic HTML tags."""
        html = "<p>This is a <strong>test</strong> paragraph.</p>"
        result = remove_html_tags(html)
        # Note: With fixed paragraph preservation, inline tags create paragraph breaks
        expected_words = ["This", "is", "a", "test", "paragraph."]
        result_words = result.replace("\n\n", " ").split()
        assert result_words == expected_words, (
            f"Expected words preserved: {expected_words}, got: {result_words}"
        )

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

        # With paragraph preservation, block elements should create paragraph breaks
        assert "Title" in result
        assert "Paragraph with" in result
        assert "link" in result
        assert "emphasis" in result
        assert "Item 1" in result
        assert "Item 2" in result

        # Should have paragraph structure preserved
        assert "\n\n" in result, "Block elements should create paragraph breaks"

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

        # Should normalize excessive spaces within text
        assert "Text with lots" in result
        assert "of whitespace" in result

        # Should preserve some paragraph structure but normalize excessive newlines
        # The exact structure depends on how BeautifulSoup parses the HTML
        lines = [line.strip() for line in result.split("\n\n") if line.strip()]
        combined_text = " ".join(lines)
        assert "Text with lots of whitespace" in combined_text

    def test_paragraph_preservation_regression(self):
        """
        REGRESSION TEST: Ensure paragraph structure is preserved in HTML content.

        This test prevents the critical bug where remove_html_tags() was destroying
        all paragraph markings (\n\n) by collapsing them into single spaces.

        Bug details: Line 52 was using re.sub(r'\s+', ' ', text) which replaced
        all whitespace including \n\n with single spaces, destroying semantic
        chunking effectiveness.
        """
        # Test case that specifically reproduces the original bug scenario
        html_content = """<p>This is the first paragraph. It contains important spiritual teachings about meditation and inner development.</p>

<p>This is the second paragraph. It continues the discussion with more insights about the spiritual path.</p>

<p>Here's a third paragraph that adds more context and depth to the spiritual topic being discussed.</p>

<p>And finally, the fourth paragraph wraps up the content with concluding thoughts.</p>"""

        result = remove_html_tags(html_content)

        # Critical assertions to prevent regression
        assert "\n\n" in result, (
            "REGRESSION: Paragraph breaks (\n\n) were destroyed during HTML cleaning!"
        )

        # Count paragraph breaks - should have 3 double newlines for 4 paragraphs
        paragraph_breaks = result.count("\n\n")
        assert paragraph_breaks >= 3, (
            f"Expected at least 3 paragraph breaks, got {paragraph_breaks}"
        )

        # Ensure we don't have a single collapsed line
        assert len(result.split("\n\n")) >= 4, (
            "Content was collapsed into too few paragraphs"
        )

        # Verify HTML tags are removed but content preserved
        assert "<p>" not in result and "</p>" not in result, (
            "HTML tags should be removed"
        )
        assert "first paragraph" in result and "fourth paragraph" in result, (
            "Content should be preserved"
        )

        # Verify the specific pattern that was broken before the fix
        lines = result.split("\n\n")
        meaningful_lines = [line.strip() for line in lines if line.strip()]
        assert len(meaningful_lines) >= 4, (
            f"Expected 4+ meaningful paragraphs, got {len(meaningful_lines)}"
        )

    def test_mixed_html_paragraph_preservation(self):
        """Test paragraph preservation with mixed HTML block elements."""
        html = """
        <div>
            <h2>Section Title</h2>
            <p>First paragraph in the section.</p>
            <p>Second paragraph with more content.</p>
        </div>
        <div>
            <p>Third paragraph in different div.</p>
        </div>
        """
        result = remove_html_tags(html)

        # Should preserve paragraph structure from block elements
        assert "\n\n" in result, "Block elements should create paragraph breaks"
        assert result.count("\n\n") >= 2, "Should have multiple paragraph breaks"

        # Verify content is preserved
        assert "Section Title" in result
        assert "First paragraph" in result
        assert "Third paragraph" in result


class TestReplaceSmartQuotes:
    """Test smart quote and Unicode character replacement."""

    def test_single_quotes(self):
        """Test replacement of smart single quotes."""
        text = "It's a \u201csmart\u201d quote test."
        result = replace_smart_quotes(text)
        assert result == 'It\'s a "smart" quote test.'

    def test_double_quotes(self):
        """Test replacement of smart double quotes."""
        text = "\u201cHello,\u201d she said. \u201cHow are you?\u201d"
        result = replace_smart_quotes(text)
        assert result == '"Hello," she said. "How are you?"'

    def test_dashes_and_ellipsis(self):
        """Test replacement of various dashes and ellipsis."""
        text = "A long dash—and an en dash–plus ellipsis…"
        result = replace_smart_quotes(text)
        assert result == "A long dash-and an en dash-plus ellipsis..."

    def test_special_spaces_and_symbols(self):
        """Test replacement of non-breaking spaces and other symbols."""
        text = "Non-breaking\u00a0space and bullet\u2022point"
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
        lines = result.split("\n")
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
        # With paragraph preservation, expect structure to be maintained
        expected_words = ["HTML", "content", "with", "tags"]
        result_words = result.replace("\n\n", " ").split()
        assert result_words == expected_words

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
        # Verify content is preserved and smart quotes are converted
        assert 'Text with "smart quotes"' in result
        assert "emphasis" in result
        # Should not contain original smart quotes or HTML tags
        assert "\u201c" not in result and "\u201d" not in result
        assert "<" not in result and ">" not in result

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
        # Verify HTML tags are removed and content is preserved
        expected_words = ["Web", "content", "with", "HTML", "tags"]
        result_words = result.replace("\n\n", " ").split()
        assert result_words == expected_words
        assert "<" not in result and ">" not in result

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
        expected_presets = [
            "pdf_document",
            "web_content",
            "database_field",
            "minimal_clean",
        ]
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
