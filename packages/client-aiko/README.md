# @ai16z/client-aiko

A TypeScript client for creating interactive AI streaming agents with animation, speech, and real-time responses.

## Features

    - Task-based priority system for handling multiple agent behaviors
    - Real-time chat interaction and response generation
    - Gift handling and acknowledgment system
    - Top supporter recognition
    - Animation generation and control
    - Text-to-speech generation
    - Streaming status management

## Installation

Coming soon

## Basic Usage

    ```typescript
    import { AikoClientInterface } from '@ai16z/client-aiko';
    import { IAgentRuntime } from '@ai16z/eliza';

    // Initialize the runtime with your agent configuration
    const runtime: IAgentRuntime = {
        // Your runtime configuration
    };

    // Start the client
    const client = await AikoClientInterface.start(runtime);
    ```

## Task System

    The client uses a priority-based task system to manage different agent behaviors. Key tasks include:

    - Reading and responding to gifts
    - Reading and replying to chat messages
    - Responding to top likers
    - Generating fresh thoughts
    - Managing periodic animations
    - Maintaining heartbeat status

## API Endpoints

    The client communicates with a server using predefined endpoints for:

    - AI responses
    - Animation updates
    - Streaming status updates
    - Comment management
    - Audio generation

## Animations

    The client supports various animation categories:

    - Idle animations
    - Head movements
    - Gestures
    - Dancing
    - Special actions

## Response Templates

    The client uses customizable templates for different types of responses:

    - Message handling
    - Gift responses
    - Top liker acknowledgments
    - Animation generation

## Environment Variables

    Required environment variables:

    ```bash
    AIKO_API_KEY=your_api_key_here
    ```

## Development

    To build the project:

    ```bash
    npm run build
    ```

    To run in development mode with watch:

    ```bash
    npm run dev
    ```

## Dependencies

    Key dependencies include:

    - @ai16z/eliza
    - @ai16z/plugin-image-generation
    - body-parser
    - cors
    - multer

## License

    MIT

## Contributing

    Contributions are welcome! Please feel free to submit a Pull Request.
