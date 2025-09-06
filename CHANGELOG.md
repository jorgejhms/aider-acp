# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2025-01-06

### Added
- Initial project setup and configuration
- TypeScript configuration with strict type checking
- NPM project initialization with dependencies
- Core ACP (Anthropic Computer Use Protocol) agent implementation
- AiderProcessManager class for managing Aider subprocess interactions
- Output parsing utilities and type definitions
- Support for filtering echoed commands from Aider output
- Basic index.ts entry point
- Project documentation (AGENTS.md, README.md)
- Git ignore configuration for .aider files

### Changed
- Improved ACP agent prompt handling and processing
- Enhanced Aider output parsing with better formatting
- Refactored output parser integration into main agent process

### Fixed
- Command echo filtering in Aider output processing
- Output formatting to ensure proper line separation
- Aider output parsing improvements
- Commented out code block handling for stability

### Documentation
- Added comprehensive agent guidelines (AGENTS.md)
- Updated project README with current status
- Established coding standards and build instructions

[0.1.0]: https://github.com/jorgejhms/aider-acp/releases/tag/v0.1.0