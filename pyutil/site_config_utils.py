#!/usr/bin/env python
"""
Site Configuration Utilities

This module provides utilities for loading and processing site configuration
from the centralized config.json file. It includes functions for:

1. Loading site-specific configuration
2. Determining access levels based on file paths
3. Managing site-specific settings across the application

Usage:
    from pyutil.site_config_utils import load_site_config, determine_access_level

    config = load_site_config("ananda")
    access_level = determine_access_level(file_path, config)
"""

import json
import logging
import os
from typing import Any

logger = logging.getLogger(__name__)


def load_site_config(site_id: str) -> dict[str, Any]:
    """
    Load site configuration from web/site-config/config.json

    Args:
        site_id: Site identifier (e.g., 'ananda', 'crystal', 'jairam', 'ananda-public')

    Returns:
        Site configuration dictionary containing site-specific settings

    Raises:
        FileNotFoundError: If config.json file is not found
        KeyError: If site_id is not found in configuration
    """
    try:
        # Navigate from pyutil/ to web/site-config/config.json
        config_path = os.path.join(
            os.path.dirname(__file__), "..", "web", "site-config", "config.json"
        )
        config_path = os.path.normpath(config_path)

        with open(config_path, encoding="utf-8") as f:
            all_configs = json.load(f)

        if site_id not in all_configs:
            logger.warning(f"Site ID '{site_id}' not found in configuration")
            return {}

        return all_configs[site_id]

    except FileNotFoundError:
        logger.error(f"Site configuration file not found at {config_path}")
        return {}
    except json.JSONDecodeError as e:
        logger.error(f"Invalid JSON in site configuration file: {e}")
        return {}
    except Exception as e:
        logger.warning(f"Could not load site config for {site_id}: {e}")
        return {}


def determine_access_level(file_path: str, site_config: dict[str, Any]) -> str:
    """
    Determine access level based on file path and site configuration.

    This function checks the file path against patterns defined in the site
    configuration's accessLevelPathMap to determine the appropriate access level.

    Args:
        file_path: Path to the file being processed (can be relative or absolute)
        site_config: Site configuration dictionary containing accessLevelPathMap

    Returns:
        Access level string (e.g., 'public', 'kriyaban', 'admin')
        Returns 'public' as default if no patterns match or if inputs are invalid

    Example:
        >>> config = {"accessLevelPathMap": {"kriyaban": ["Kriyaban Only"]}}
        >>> determine_access_level("treasures/Kriyaban Only/file.mp3", config)
        'kriyaban'
        >>> determine_access_level("treasures/public/file.mp3", config)
        'public'
    """
    if not file_path:
        return "public"

    access_level_path_map = site_config.get("accessLevelPathMap", {})

    if not access_level_path_map:
        return "public"

    for access_level, path_patterns in access_level_path_map.items():
        if not isinstance(path_patterns, list):
            logger.warning(
                f"Invalid path patterns for access level '{access_level}': expected list"
            )
            continue

        for pattern in path_patterns:
            if not isinstance(pattern, str):
                logger.warning(
                    f"Invalid pattern in access level '{access_level}': expected string"
                )
                continue

            # Case-insensitive substring match
            if pattern.lower() in file_path.lower():
                logger.debug(
                    f"File {file_path} matched pattern '{pattern}' -> access_level: {access_level}"
                )
                return access_level

    # Default to public if no patterns match
    return "public"


def get_excluded_access_levels(site_config: dict[str, Any]) -> list:
    """
    Get the list of access levels that should be excluded from queries.

    Args:
        site_config: Site configuration dictionary

    Returns:
        List of access levels to exclude (e.g., ['kriyaban', 'admin'])
        Returns empty list if no exclusions are configured
    """
    return site_config.get("excludedAccessLevels", [])


def get_access_level_path_map(site_config: dict[str, Any]) -> dict[str, list]:
    """
    Get the access level path mapping from site configuration.

    Args:
        site_config: Site configuration dictionary

    Returns:
        Dictionary mapping access levels to path patterns
        Returns empty dict if no mapping is configured
    """
    return site_config.get("accessLevelPathMap", {})


def validate_site_config(site_config: dict[str, Any]) -> bool:
    """
    Validate that a site configuration has the required structure.

    Args:
        site_config: Site configuration dictionary to validate

    Returns:
        True if configuration is valid, False otherwise
    """
    if not isinstance(site_config, dict):
        logger.error("Site configuration must be a dictionary")
        return False

    # Check if accessLevelPathMap is properly structured
    access_level_path_map = site_config.get("accessLevelPathMap", {})
    if access_level_path_map and not isinstance(access_level_path_map, dict):
        logger.error("accessLevelPathMap must be a dictionary")
        return False

    for access_level, patterns in access_level_path_map.items():
        if not isinstance(patterns, list):
            logger.error(f"Patterns for access level '{access_level}' must be a list")
            return False

        for pattern in patterns:
            if not isinstance(pattern, str):
                logger.error(
                    f"Pattern in access level '{access_level}' must be a string"
                )
                return False

    # Check if excludedAccessLevels is properly structured
    excluded_levels = site_config.get("excludedAccessLevels", [])
    if excluded_levels and not isinstance(excluded_levels, list):
        logger.error("excludedAccessLevels must be a list")
        return False

    return True
