"""
Traceform Python SDK — Instrumentation Tests

Tests for auto-instrumentation modules to verify they:
- Handle missing libraries gracefully (ImportError)
- Do not crash on import
- Properly guard against re-instrumentation
"""

import pytest


# ===========================================================================
# LLAMAINDEX INSTRUMENTATION TESTS
# ===========================================================================

class TestLlamaIndexInstrumentation:
    """Tests for the LlamaIndex instrumentation module."""

    def test_import_module(self):
        """Module can be imported without error."""
        from traceform.instruments.llamaindex import instrument, uninstrument
        assert callable(instrument)
        assert callable(uninstrument)

    def test_instrument_without_llamaindex(self):
        """Should raise ImportError when llama_index is not installed."""
        from traceform.instruments.llamaindex import instrument
        with pytest.raises(ImportError, match="llama-index-core"):
            instrument()

    def test_uninstrument_without_prior_instrument(self):
        """Should not crash when uninstrumenting without prior instrumentation."""
        from traceform.instruments.llamaindex import uninstrument
        uninstrument()  # Should be a no-op

    def test_double_uninstrument(self):
        """Should handle double uninstrument gracefully."""
        from traceform.instruments.llamaindex import uninstrument
        uninstrument()
        uninstrument()


# ===========================================================================
# AUTOGEN INSTRUMENTATION TESTS
# ===========================================================================

class TestAutoGenInstrumentation:
    """Tests for the AutoGen/AG2 instrumentation module."""

    def test_import_module(self):
        """Module can be imported without error."""
        from traceform.instruments.autogen import instrument, uninstrument
        assert callable(instrument)
        assert callable(uninstrument)

    def test_instrument_without_autogen(self):
        """Should raise ImportError when neither autogen nor ag2 is installed."""
        from traceform.instruments.autogen import instrument
        with pytest.raises(ImportError, match="pyautogen.*ag2"):
            instrument()

    def test_uninstrument_without_prior_instrument(self):
        """Should not crash when uninstrumenting without prior instrumentation."""
        from traceform.instruments.autogen import uninstrument
        uninstrument()

    def test_double_uninstrument(self):
        """Should handle double uninstrument gracefully."""
        from traceform.instruments.autogen import uninstrument
        uninstrument()
        uninstrument()


# ===========================================================================
# HAYSTACK INSTRUMENTATION TESTS
# ===========================================================================

class TestHaystackInstrumentation:
    """Tests for the Haystack instrumentation module."""

    def test_import_module(self):
        """Module can be imported without error."""
        from traceform.instruments.haystack import instrument, uninstrument
        assert callable(instrument)
        assert callable(uninstrument)

    def test_instrument_without_haystack(self):
        """Should raise ImportError when haystack-ai is not installed."""
        from traceform.instruments.haystack import instrument
        with pytest.raises(ImportError, match="haystack-ai"):
            instrument()

    def test_uninstrument_without_prior_instrument(self):
        """Should not crash when uninstrumenting without prior instrumentation."""
        from traceform.instruments.haystack import uninstrument
        uninstrument()

    def test_double_uninstrument(self):
        """Should handle double uninstrument gracefully."""
        from traceform.instruments.haystack import uninstrument
        uninstrument()
        uninstrument()


# ===========================================================================
# AUTO-INSTRUMENT REGISTRY TESTS
# ===========================================================================

class TestInstrumentRegistry:
    """Tests for the instruments __init__.py auto-instrument function."""

    def test_instrument_returns_empty_for_missing_libs(self):
        """instrument() should return empty list when no libraries are installed."""
        from traceform.instruments import instrument
        # These libraries are not installed in test environment
        result = instrument(libraries=["llamaindex", "autogen", "haystack"])
        assert isinstance(result, list)
        assert len(result) == 0

    def test_instrument_unknown_library_skipped(self):
        """instrument() should skip unknown library names."""
        from traceform.instruments import instrument
        result = instrument(libraries=["nonexistent_library"])
        assert isinstance(result, list)
        assert len(result) == 0

    def test_instrument_new_libraries_in_supported(self):
        """New libraries should be in the supported dict."""
        from traceform.instruments import instrument
        # Verify the function accepts the new library names
        # (they will fail to instrument because the libs aren't installed,
        # but they should not raise KeyError)
        result = instrument(libraries=["llamaindex"])
        assert isinstance(result, list)

        result = instrument(libraries=["autogen"])
        assert isinstance(result, list)

        result = instrument(libraries=["haystack"])
        assert isinstance(result, list)

    def test_instrument_all_returns_list(self):
        """instrument() with no args attempts all and returns a list."""
        from traceform.instruments import instrument
        result = instrument()
        assert isinstance(result, list)
        # Most/all will fail since test libs aren't installed,
        # but it should not crash
