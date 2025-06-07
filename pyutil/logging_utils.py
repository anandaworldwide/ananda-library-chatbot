import logging

from colorama import Fore, Style, init

# Initialize colorama
init(autoreset=True)


class ColorFormatter(logging.Formatter):
    def format(self, record):
        if record.levelno == logging.WARNING:
            record.msg = f"{Fore.YELLOW}{record.msg}{Style.RESET_ALL}"
        elif record.levelno >= logging.ERROR:
            record.msg = f"{Fore.RED}{record.msg}{Style.RESET_ALL}"
        return super().format(record)


def configure_logging(debug=False):
    root_logger = logging.getLogger()
    if not root_logger.handlers:  # Only add handler if none exist
        formatter = ColorFormatter("%(asctime)s - %(levelname)s - %(message)s")
        handler = logging.StreamHandler()
        handler.setFormatter(formatter)
        root_logger.addHandler(handler)

    # Set root logger to WARNING level to reduce noise
    root_logger.setLevel(logging.WARNING)

    # Configure specific loggers for our code to be at debug level when debug=True
    our_code_loggers = [
        "data_ingestion",
        "pyutil",
        "__main__",  # For scripts run directly
    ]

    for logger_name in our_code_loggers:
        if debug:
            logging.getLogger(logger_name).setLevel(logging.DEBUG)
        else:
            logging.getLogger(logger_name).setLevel(logging.INFO)
