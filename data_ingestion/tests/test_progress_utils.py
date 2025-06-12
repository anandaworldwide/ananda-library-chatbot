"""
Unit tests for data_ingestion.utils.progress_utils module.

Tests cover all progress tracking operations including signal handling, 
checkpoint integration, and both sync and async versions with comprehensive
mocking to avoid side effects and external dependencies.
"""

import asyncio
import signal
import time
from unittest.mock import Mock, call, patch

import pytest

from data_ingestion.utils.progress_utils import (
    PROGRESS_PRESETS,
    AsyncProgressTracker,
    ProgressConfig,
    ProgressState,
    ProgressTracker,
    check_shutdown_requested,
    create_batch_progress_bar,
    create_progress_bar,
    get_progress_preset,
    is_exiting,
    monitor_async_tasks,
    reset_shutdown_state,
    set_exiting,
    setup_signal_handlers,
    signal_handler,
    with_progress_bar,
)


class TestShutdownState:
    """Test shutdown state management functions."""
    
    def setup_method(self):
        """Reset shutdown state before each test."""
        reset_shutdown_state()
    
    def teardown_method(self):
        """Reset shutdown state after each test."""
        reset_shutdown_state()
    
    def test_initial_state(self):
        """Test initial shutdown state is False."""
        assert is_exiting() is False
        assert check_shutdown_requested() is False
    
    def test_set_exiting_true(self):
        """Test setting shutdown state to True."""
        set_exiting(True)
        assert is_exiting() is True
        assert check_shutdown_requested() is True
    
    def test_set_exiting_false(self):
        """Test setting shutdown state to False."""
        set_exiting(True)
        set_exiting(False)
        assert is_exiting() is False
    
    def test_reset_shutdown_state(self):
        """Test resetting shutdown state."""
        set_exiting(True)
        reset_shutdown_state()
        assert is_exiting() is False


class TestSignalHandler:
    """Test signal handling functionality."""
    
    def setup_method(self):
        """Reset shutdown state before each test."""
        reset_shutdown_state()
    
    def teardown_method(self):
        """Reset shutdown state after each test."""
        reset_shutdown_state()
    
    def test_signal_handler_first_call(self):
        """Test signal handler on first call sets shutdown state."""
        signal_handler(signal.SIGINT, None)
        assert is_exiting() is True
    
    def test_signal_handler_second_call(self):
        """Test signal handler on second call forces exit."""
        # First call
        signal_handler(signal.SIGINT, None)
        assert is_exiting() is True
        
        # Second call should force exit
        with pytest.raises(SystemExit) as exc_info:
            signal_handler(signal.SIGINT, None)
        assert exc_info.value.code == 1
    
    def test_setup_signal_handlers_default(self):
        """Test setting up default signal handlers."""
        with patch('signal.signal') as mock_signal:
            setup_signal_handlers()
            mock_signal.assert_called_once_with(signal.SIGINT, signal_handler)
    
    def test_setup_signal_handlers_custom(self):
        """Test setting up custom signal handlers."""
        custom_handler = Mock()
        with patch('signal.signal') as mock_signal:
            setup_signal_handlers(custom_handler, [signal.SIGINT, signal.SIGTERM])
            
            expected_calls = [
                call(signal.SIGINT, custom_handler),
                call(signal.SIGTERM, custom_handler)
            ]
            mock_signal.assert_has_calls(expected_calls)


class TestProgressConfig:
    """Test ProgressConfig functionality."""
    
    def test_default_config(self):
        """Test default progress configuration."""
        config = ProgressConfig()
        
        assert config.description == "Processing"
        assert config.unit == "item"
        assert config.total is None
        assert config.show_progress is True
        assert config.checkpoint_interval == 1
        assert config.enable_eta is True
        assert config.bar_format is None
        assert config.ncols is None
    
    def test_custom_config(self):
        """Test custom progress configuration."""
        config = ProgressConfig(
            description="Custom task",
            unit="file",
            total=100,
            show_progress=False,
            checkpoint_interval=5,
            enable_eta=False,
            bar_format="{desc}: {percentage}%",
            ncols=80
        )
        
        assert config.description == "Custom task"
        assert config.unit == "file"
        assert config.total == 100
        assert config.show_progress is False
        assert config.checkpoint_interval == 5
        assert config.enable_eta is False
        assert config.bar_format == "{desc}: {percentage}%"
        assert config.ncols == 80


class TestProgressState:
    """Test ProgressState functionality."""
    
    def test_default_state(self):
        """Test default progress state."""
        state = ProgressState()
        
        assert state.current == 0
        assert state.total is None
        assert state.last_checkpoint == 0
        assert state.interrupted is False
        assert state.error_count == 0
        assert state.success_count == 0
        assert isinstance(state.start_time, float)
        assert isinstance(state.last_checkpoint_time, float)
    
    def test_custom_state(self):
        """Test custom progress state."""
        custom_time = time.time()
        state = ProgressState(
            current=50,
            total=100,
            start_time=custom_time,
            last_checkpoint=25,
            last_checkpoint_time=custom_time,
            interrupted=True,
            error_count=2,
            success_count=48
        )
        
        assert state.current == 50
        assert state.total == 100
        assert state.start_time == custom_time
        assert state.last_checkpoint == 25
        assert state.last_checkpoint_time == custom_time
        assert state.interrupted is True
        assert state.error_count == 2
        assert state.success_count == 48


class TestCreateProgressBar:
    """Test progress bar creation."""
    
    def test_create_progress_bar_basic(self):
        """Test basic progress bar creation."""
        config = ProgressConfig(description="Test", total=100)
        
        with patch('data_ingestion.utils.progress_utils.tqdm') as mock_tqdm:
            mock_bar = Mock()
            mock_tqdm.return_value = mock_bar
            
            result = create_progress_bar(config)
            
            mock_tqdm.assert_called_once_with(
                desc="Test",
                unit="item",
                total=100,
                disable=False,
                unit_scale=True
            )
            assert result == mock_bar
    
    def test_create_progress_bar_with_iterable(self):
        """Test progress bar creation with iterable."""
        config = ProgressConfig(description="Test")
        items = [1, 2, 3, 4, 5]
        
        with patch('data_ingestion.utils.progress_utils.tqdm') as mock_tqdm:
            mock_bar = Mock()
            mock_tqdm.return_value = mock_bar
            
            result = create_progress_bar(config, items)
            
            mock_tqdm.assert_called_once_with(
                items,
                desc="Test",
                unit="item",
                total=None,
                disable=False
            )
            assert result == mock_bar
    
    def test_create_progress_bar_disabled(self):
        """Test progress bar creation when disabled."""
        config = ProgressConfig(show_progress=False)
        
        with patch('data_ingestion.utils.progress_utils.tqdm') as mock_tqdm:
            create_progress_bar(config)
            
            # Check that disable=True was passed
            call_kwargs = mock_tqdm.call_args[1]
            assert call_kwargs['disable'] is True
    
    def test_create_progress_bar_custom_format(self):
        """Test progress bar with custom format and columns."""
        config = ProgressConfig(
            bar_format="{desc}: {percentage}%",
            ncols=80
        )
        
        with patch('data_ingestion.utils.progress_utils.tqdm') as mock_tqdm:
            create_progress_bar(config)
            
            call_kwargs = mock_tqdm.call_args[1]
            assert call_kwargs['bar_format'] == "{desc}: {percentage}%"
            assert call_kwargs['ncols'] == 80


class TestProgressTracker:
    """Test ProgressTracker context manager."""
    
    def setup_method(self):
        """Reset shutdown state before each test."""
        reset_shutdown_state()
    
    def teardown_method(self):
        """Reset shutdown state after each test."""
        reset_shutdown_state()
    
    def test_basic_context_manager(self):
        """Test basic progress tracker usage."""
        config = ProgressConfig(description="Test", total=10)
        
        with patch('data_ingestion.utils.progress_utils.create_progress_bar') as mock_create:
            mock_bar = Mock()
            mock_create.return_value = mock_bar
            
            with ProgressTracker(config) as tracker:
                assert tracker.config == config
                assert tracker.state.current == 0
                assert tracker.progress_bar == mock_bar
            
            mock_create.assert_called_once_with(config)
            mock_bar.close.assert_called_once()
    
    def test_progress_update(self):
        """Test progress updates."""
        config = ProgressConfig(total=10, show_progress=False)
        
        with ProgressTracker(config) as tracker:
            # Test single update
            result = tracker.update()
            assert result is True
            assert tracker.state.current == 1
            
            # Test multiple update
            result = tracker.update(5)
            assert result is True
            assert tracker.state.current == 6
    
    def test_progress_update_with_shutdown(self):
        """Test progress update when shutdown requested."""
        config = ProgressConfig(show_progress=False)
        
        with ProgressTracker(config) as tracker:
            set_exiting(True)
            result = tracker.update()
            assert result is False
    
    def test_success_error_counters(self):
        """Test success and error counters."""
        config = ProgressConfig(show_progress=False)
        
        with ProgressTracker(config) as tracker:
            tracker.increment_success(3)
            tracker.increment_error(2)
            
            assert tracker.state.success_count == 3
            assert tracker.state.error_count == 2
    
    def test_set_total_and_description(self):
        """Test setting total and description."""
        config = ProgressConfig(show_progress=False)
        
        with ProgressTracker(config) as tracker:
            tracker.set_total(100)
            tracker.set_description("New description")
            
            assert tracker.state.total == 100
            assert tracker.config.total == 100
            assert tracker.config.description == "New description"
    
    def test_checkpoint_callback(self):
        """Test checkpoint callback functionality."""
        config = ProgressConfig(checkpoint_interval=3, show_progress=False)
        checkpoint_callback = Mock()
        
        with ProgressTracker(config, checkpoint_callback=checkpoint_callback) as tracker:
            # Update below checkpoint interval
            tracker.update(2)
            checkpoint_callback.assert_not_called()
            
            # Update to trigger checkpoint
            tracker.update(2)  # Total: 4, triggers checkpoint at interval 3
            checkpoint_callback.assert_called_once()
            
            # Check call arguments
            call_args = checkpoint_callback.call_args
            assert call_args[0][0] == 4  # current progress
            assert isinstance(call_args[0][1], dict)  # checkpoint data
    
    def test_cleanup_callback(self):
        """Test cleanup callback functionality."""
        config = ProgressConfig(show_progress=False)
        cleanup_callback = Mock()
        
        with ProgressTracker(config, cleanup_callback=cleanup_callback):
            pass
        
        cleanup_callback.assert_called_once()
    
    def test_cleanup_callback_error(self):
        """Test cleanup callback with error."""
        config = ProgressConfig(show_progress=False)
        cleanup_callback = Mock(side_effect=Exception("Cleanup error"))
        
        # Should not raise exception even if cleanup fails
        with ProgressTracker(config, cleanup_callback=cleanup_callback):
            pass
        
        cleanup_callback.assert_called_once()
    
    def test_exception_handling(self):
        """Test progress tracker with exception."""
        config = ProgressConfig(show_progress=False)
        
        with pytest.raises(ValueError):
            with ProgressTracker(config) as tracker:
                tracker.update()
                raise ValueError("Test error")
        
        assert tracker.state.interrupted is True
    
    def test_final_checkpoint_on_exit(self):
        """Test final checkpoint is saved on exit."""
        config = ProgressConfig(show_progress=False)
        checkpoint_callback = Mock()
        
        with ProgressTracker(config, checkpoint_callback=checkpoint_callback) as tracker:
            tracker.update(5)
        
        # Should have saved final checkpoint
        assert checkpoint_callback.call_count >= 1
        final_call = checkpoint_callback.call_args
        assert final_call[0][0] == 5


class TestAsyncProgressTracker:
    """Test AsyncProgressTracker for async operations."""
    
    def setup_method(self):
        """Reset shutdown state before each test."""
        reset_shutdown_state()
    
    def teardown_method(self):
        """Reset shutdown state after each test."""
        reset_shutdown_state()
    
    @pytest.mark.asyncio
    async def test_async_context_manager(self):
        """Test async progress tracker usage."""
        config = ProgressConfig(description="Async Test", show_progress=False)
        
        async with AsyncProgressTracker(config) as tracker:
            assert tracker.config == config
            assert tracker.state.current == 0
    
    @pytest.mark.asyncio
    async def test_async_cleanup_callback(self):
        """Test async cleanup callback."""
        config = ProgressConfig(show_progress=False)
        cleanup_callback = Mock(return_value=asyncio.Future())
        cleanup_callback.return_value.set_result(None)
        
        with patch('asyncio.iscoroutinefunction', return_value=True):
            async with AsyncProgressTracker(config, cleanup_callback=cleanup_callback):
                pass
        
        cleanup_callback.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_async_checkpoint_saving(self):
        """Test async checkpoint saving."""
        config = ProgressConfig(show_progress=False)
        checkpoint_callback = Mock(return_value=asyncio.Future())
        checkpoint_callback.return_value.set_result(None)
        
        async with AsyncProgressTracker(config, checkpoint_callback=checkpoint_callback) as tracker:
            with patch('asyncio.iscoroutinefunction', return_value=True):
                await tracker.save_checkpoint_async("test")
        
        checkpoint_callback.assert_called()


class TestUtilityFunctions:
    """Test utility functions for progress tracking."""
    
    def test_create_batch_progress_bar(self):
        """Test batch progress bar creation."""
        items = [1, 2, 3, 4, 5]
        
        with patch('data_ingestion.utils.progress_utils.create_progress_bar') as mock_create:
            mock_bar = Mock()
            mock_create.return_value = mock_bar
            
            result = create_batch_progress_bar(items, "Batch test", unit="file")
            
            # Check that create_progress_bar was called with correct config
            call_args = mock_create.call_args
            config = call_args[0][0]
            iterable = call_args[0][1]
            
            assert config.description == "Batch test"
            assert config.unit == "file"
            assert config.total == 5
            assert iterable == items
            assert result == mock_bar
    
    def test_monitor_async_tasks(self):
        """Test async task monitoring."""
        tasks = [Mock(), Mock(), Mock()]
        
        with patch('data_ingestion.utils.progress_utils.create_progress_bar') as mock_create:
            mock_bar = Mock()
            mock_create.return_value = mock_bar
            
            result = monitor_async_tasks(tasks, "Task monitor")
            
            call_args = mock_create.call_args
            config = call_args[0][0]
            
            assert config.description == "Task monitor"
            assert config.unit == "task"
            assert config.total == 3
            assert result == mock_bar


class TestProgressPresets:
    """Test progress configuration presets."""
    
    def test_all_presets_exist(self):
        """Test that all expected presets exist."""
        expected_presets = ["pdf_processing", "vector_upsert", "data_extraction", "chunk_processing"]
        
        for preset_name in expected_presets:
            assert preset_name in PROGRESS_PRESETS
    
    def test_get_valid_preset(self):
        """Test getting a valid preset."""
        config = get_progress_preset("pdf_processing")
        
        assert config.description == "Processing PDFs"
        assert config.unit == "file"
        assert config.checkpoint_interval == 1
        assert config.enable_eta is True
    
    def test_get_invalid_preset(self):
        """Test error with invalid preset name."""
        with pytest.raises(ValueError, match="Unknown preset 'invalid'"):
            get_progress_preset("invalid")
    
    def test_preset_returns_copy(self):
        """Test that preset returns a copy."""
        config1 = get_progress_preset("vector_upsert")
        config2 = get_progress_preset("vector_upsert")
        
        # Modify one config
        config1.description = "Modified"
        
        # Other config should be unchanged
        assert config2.description == "Upserting vectors"
        assert PROGRESS_PRESETS["vector_upsert"].description == "Upserting vectors"
    
    def test_preset_values(self):
        """Test specific preset values."""
        pdf_config = get_progress_preset("pdf_processing")
        assert pdf_config.description == "Processing PDFs"
        assert pdf_config.unit == "file"
        assert pdf_config.checkpoint_interval == 1
        
        vector_config = get_progress_preset("vector_upsert")
        assert vector_config.description == "Upserting vectors"
        assert vector_config.unit == "batch"
        assert vector_config.checkpoint_interval == 10
        
        data_config = get_progress_preset("data_extraction")
        assert data_config.description == "Extracting data"
        assert data_config.unit == "record"
        assert data_config.checkpoint_interval == 100
        
        chunk_config = get_progress_preset("chunk_processing")
        assert chunk_config.description == "Processing chunks"
        assert chunk_config.unit == "chunk"
        assert chunk_config.checkpoint_interval == 50


class TestDecorator:
    """Test the with_progress_bar decorator."""
    
    def test_decorator_basic(self):
        """Test basic decorator functionality."""
        config = ProgressConfig(show_progress=False)
        
        @with_progress_bar(config)
        def test_function(tracker, value):
            tracker.update()
            return value * 2
        
        result = test_function(10)
        assert result == 20
    
    def test_decorator_with_callbacks(self):
        """Test decorator with callbacks."""
        config = ProgressConfig(show_progress=False)
        checkpoint_callback = Mock()
        cleanup_callback = Mock()
        
        @with_progress_bar(config, checkpoint_callback, cleanup_callback)
        def test_function(tracker):
            tracker.update(5)
            return "done"
        
        result = test_function()
        assert result == "done"
        
        # Callbacks should have been used
        cleanup_callback.assert_called_once()


class TestIntegration:
    """Integration tests for progress utilities."""
    
    def setup_method(self):
        """Reset shutdown state before each test."""
        reset_shutdown_state()
    
    def teardown_method(self):
        """Reset shutdown state after each test."""
        reset_shutdown_state()
    
    def test_full_progress_workflow(self):
        """Test complete progress tracking workflow."""
        config = ProgressConfig(
            description="Integration test",
            total=10,
            checkpoint_interval=3,
            show_progress=False
        )
        
        checkpoint_data = []
        cleanup_called = False
        
        def checkpoint_callback(current, data):
            checkpoint_data.append((current, data))
        
        def cleanup_callback():
            nonlocal cleanup_called
            cleanup_called = True
        
        with ProgressTracker(config, checkpoint_callback, cleanup_callback) as tracker:
            for i in range(10):
                if not tracker.update():
                    break
                
                if i % 2 == 0:
                    tracker.increment_success()
                else:
                    tracker.increment_error()
        
        # Check final state
        assert tracker.state.current == 10
        assert tracker.state.success_count == 5
        assert tracker.state.error_count == 5
        
        # Check that checkpoints were saved
        assert len(checkpoint_data) >= 1  # At least final checkpoint
        
        # Check cleanup was called
        assert cleanup_called is True
    
    def test_signal_handling_integration(self):
        """Test signal handling with progress tracking."""
        config = ProgressConfig(show_progress=False)
        
        with patch('data_ingestion.utils.progress_utils.signal.signal') as mock_signal:
            setup_signal_handlers()
            
            with ProgressTracker(config) as tracker:
                # Simulate signal
                set_exiting(True)
                
                # Next update should detect shutdown
                result = tracker.update()
                assert result is False
            
            mock_signal.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_async_integration(self):
        """Test async progress tracking integration."""
        config = ProgressConfig(show_progress=False, checkpoint_interval=2)
        checkpoint_data = []
        
        async def async_checkpoint_callback(current, data):
            checkpoint_data.append((current, data))
        
        # Patch the checkpoint callback to avoid the sync call warning
        with patch.object(AsyncProgressTracker, '_save_checkpoint') as mock_save:
            async with AsyncProgressTracker(config, async_checkpoint_callback) as tracker:
                for i in range(5):
                    tracker.update()
                    
                    # Test async checkpoint saving
                    if i == 2:
                        await tracker.save_checkpoint_async("manual")
            
            assert tracker.state.current == 5
            # Mock was called for automatic checkpoints, plus manual checkpoint call
            assert len(checkpoint_data) >= 1 