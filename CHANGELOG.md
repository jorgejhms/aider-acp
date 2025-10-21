# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2025-10-21

### BREAKING CHANGES
- Update from @zed-industries/agent-client-protocol to @agentclientprotocol/sdk v0.4.8
- Complete rewrite of Aider output parser using typescript-parsec
- Update AgentSideConnection initialization for new SDK compatibility

### Added
- Emojis to file information messages for better user experience
- File emoji (📄) for "Added {file} to the chat" messages
- Warning emoji (⚠️) for "{file} is already in the chat as an editable file" messages
- TypeScript-parsec v0.3.4 dependency for robust parsing capabilities
- Test mode (--test-parser flag) for parser testing and debugging
- Example text directory structure for future parser testing

### Changed
- Improved handling of multiple text prompts and resource processing
- Enhanced text prompt combination and whitespace trimming
- Streamlined turn completion logic for better agent responsiveness
- Cleaner chat interface output by filtering out context file names
- Update build commands from npm to pnpm throughout documentation

### Fixed
- Filter duplicated commands from Aider output that start with '> '
- Handle multiple text prompts correctly after all resources have been processed
- Remove context file names from chat output for cleaner user interface
- Enhanced error handling and parsing reliability in output processing

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

[0.2.0]: https://github.com/jorgejhms/aider-acp/releases/tag/v0.2.0
[0.1.0]: https://github.com/jorgejhms/aider-acp/releases/tag/v0.1.0
