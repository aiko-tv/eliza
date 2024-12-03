import {
    Client,
    Content,
    IAgentRuntime,
    Memory,
    ModelClass,
    ServiceType,
    State,
    UUID
} from "@ai16z/eliza/src/types.ts";
import { stringToUuid } from "@ai16z/eliza/src/uuid.ts";
import { fetchRoomMessages, fetchTopLikers, fetchUnreadComments, fetchUnreadGifts, getRandomTopLiker, IComment, markCommentsAsRead, markGiftsAsRead, postRoomMessage } from './db/index.ts';
import { composeContext, embeddingZeroVector } from "@ai16z/eliza";
import { generateMessageResponse, generateText } from "@ai16z/eliza/src/index.ts";
import https from 'https';
import { parseJSONObjectFromText } from "@ai16z/eliza/src/parsing.ts";
import {
    aikoAnimationTemplate,
    aikoGiftResponseTemplate,
    aikoMessageAnimationTemplate,
    aikoMessageHandlerTemplate,
    aikoSelectCommentTemplate,
    aikoTopLikerTemplate
} from "./templates.ts";
import { ANIMATION_OPTIONS, SERVER_ENDPOINTS, SERVER_URL, getAllAnimations } from "./constants.ts";
import { AIResponse, StreamingStatusUpdate, TaskPriority } from "./types.ts";

const api_key = process.env.AIKO_API_KEY;

export class AikoClient {
    interval: NodeJS.Timeout;

    intervalTopLikers: NodeJS.Timeout;
    intervalTotalLikes: NodeJS.Timeout;
    runtime: IAgentRuntime;

    roomId: UUID;

    private taskQueue: TaskPriority[] = [
        {
            name: 'readGifts',
            priority: 1,
            minInterval: 1000 * 25
        },
        {
            name: 'readChatAndReply',
            priority: 2,
            minInterval: 1000 * 20
        },
        {
            name: 'readAndRespondToTopLikers',
            priority: 3,
            minInterval: 1000 * 90
        },
        {
            name: 'generateFreshThought',
            priority: 4,
            minInterval: 1000 * 30 * 1
        },
        {
            name: 'readAgentChatAndReply',
            priority: 4,
            minInterval: 1000 * 60 * 1
        },
        {
            name: 'generatePeriodicAnimation',
            priority: 5,
            minInterval: 1000 * 20
        },
        {
            name: 'heartbeat',
            priority: 5,
            minInterval: 1000 * 5
        },
    ];

    private taskInterval: NodeJS.Timeout;
    private lastProcessedTimestamp: Date | undefined;
    private lastAgentChatMessageId: string | null = null;

    constructor(runtime: IAgentRuntime) {
        this.runtime = runtime;
        this.roomId = stringToUuid(`aiko-stream-${this.runtime.agentId}`);
        this.lastProcessedTimestamp = new Date();

        console.log("aiko: constructor", {
            runtime: this.runtime,
            settings: this.runtime.character.settings,
            vrm: this.runtime.character.settings?.secrets?.vrm,
            avatar: this.runtime.character.settings?.secrets?.avatar,
            lastProcessedTimestamp: this.lastProcessedTimestamp
        });

        // Start the task scheduler
        this.taskInterval = setInterval(() => {
            this.processNextTask();
        }, 1000); // Check for new tasks every second
    }

    /**
     * Processes the next available task in the task queue based on priority and timing
     * Tasks are executed sequentially to avoid conflicts and maintain system stability
     */
    private async processNextTask() {
        // Get current timestamp to check task eligibility
        const now = Date.now();

        // Find the highest priority task that:
        // 1. Isn't currently running
        // 2. Has waited long enough since its last run (minInterval)
        const eligibleTask = this.taskQueue.find(task => {
            const timeElapsed = now - (task.lastRun || 0);
            return !task.isRunning && timeElapsed >= task.minInterval;
        });

        // Exit if no tasks are eligible to run
        if (!eligibleTask) return;

        // Set task status to running to prevent concurrent execution
        eligibleTask.isRunning = true;

        try {
            // Execute the appropriate task based on task name
            // Each task handles a different aspect of the AI's behavior:
            // - readGifts: Process and respond to viewer gifts
            // - readChatAndReply: Monitor chat and generate responses
            // - readAndRespondToTopLikers: Thank active supporters
            // - generateFreshThought: Create unprompted messages
            // - generatePeriodicAnimation: Update AI's animation state
            // - heartbeat: Maintain connection status
            switch (eligibleTask.name) {
                case 'readGifts':
                    await this.readGifts();
                    break;
                case 'readChatAndReply':
                    await this.readChatAndReply();
                    break;
                case 'readAndRespondToTopLikers':
                    await this.readAndRespondToTopLikers();
                    break;
                case 'generateFreshThought':
                    await this.generateAndShareFreshThought();
                    break;
                case 'readAgentChatAndReply':
                    await this.readAgentChatAndReply();
                    break;
                case 'generatePeriodicAnimation':
                    await this.generateAndSharePeriodicAnimation();
                    break;
                case 'heartbeat':
                    await this.heartbeat();
                    break;
            }
        } catch (error) {
            // Log any errors that occur during task execution
            console.error(`Error executing task ${eligibleTask.name}:`, error);
        } finally {
            // Clean up task state regardless of success/failure:
            // - Update the last run timestamp
            // - Reset the running flag to allow future execution
            eligibleTask.lastRun = Date.now();
            eligibleTask.isRunning = false;
        }
    }

    async heartbeat() {
        await this.updateStreamingStatus({
            isStreaming: true,
        });
    }

    async readAndRespondToTopLikers() {
        try {
            // Randomly choose timeframe to fetch top likers from
            const use5MinWindow = Math.random() < 0.5; // 50% chance of using 5min window
            const timeframe = use5MinWindow ? '5m' : 'all';

            // Fetch top likers using the provided function
            const { success, topLikers, error } = await fetchTopLikers(
                this.runtime.agentId,
                undefined, // default limit
                timeframe
            );

            if (!success || !topLikers) {
                console.error("Failed to fetch top likers:", error);
                return;
            }

            // Get a random top liker to thank
            const selectedLiker = getRandomTopLiker(topLikers);
            if (!selectedLiker) {
                console.log("No top likers available to thank");
                return;
            }

            // Generate response using the template
            const context = composeContext({
                state: await this.runtime.composeState({
                    userId: this.runtime.agentId,
                    agentId: this.runtime.agentId,
                    content: { text: '', source: "aiko" },
                    roomId: this.roomId,
                }, {
                    agentName: this.runtime.character.name,
                    username: selectedLiker.handle,
                    likeCount: selectedLiker.likeCount,
                }),
                template: aikoTopLikerTemplate,
            });

            const responseText = await generateText({
                runtime: this.runtime,
                context,
                modelClass: ModelClass.SMALL,
            });

            const parsedResponse = parseJSONObjectFromText(responseText);
            if (!parsedResponse) {
                console.error("Failed to parse top liker response:", responseText);
                return;
            }

            // Prepare the response body
            const body: AIResponse = {
                id: stringToUuid(`${this.runtime.agentId}-${Date.now()}`),
                text: parsedResponse.text,
                agentId: this.runtime.agentId,
                animation: parsedResponse.animation,

                replyToUser: selectedLiker.handle,
                replyToHandle: selectedLiker.handle,
                replyToPfp: selectedLiker.pfp,

                isTopLikerResponse: true,

            };

            // Post the response
            const fetchResponse = await fetch(SERVER_ENDPOINTS.POST.AI_RESPONSES, {
                method: "POST",
                headers: {
                    'Content-Type': 'application/json',
                    'api_key': api_key
                },
                body: JSON.stringify(body),
            });

            if (fetchResponse.ok) {
                // Update the last thank time
                console.log(`Thanked top liker: ${selectedLiker.handle}`);
            } else {
                console.error("Failed to post top liker response:", await fetchResponse.text());
            }

        } catch (error) {
            console.error("Error in readAndRespondToTopLikers:", error);
        }
    }

    async readChatAndReply() {
        try {
            // Read Comments since last processed timestamp
            console.log(`[${new Date().toLocaleString()}] Aiko (${this.runtime.character.name}): Reading chat since`,
                this.lastProcessedTimestamp?.toISOString());

            const { comments } = await fetchUnreadComments(
                this.runtime.agentId,
                this.lastProcessedTimestamp
            );

            if (comments && comments.length > 0) {
                // Process each comment and store it as a memory
                const processedComments = await this.processComments(comments);
                console.log("aiko: processedComments", {
                    count: processedComments?.length,
                    lastProcessedTimestamp: this.lastProcessedTimestamp?.toISOString()
                });
            }

            // Update the timestamp to current time after processing
            this.lastProcessedTimestamp = new Date();

        } catch (error) {
            console.error("Error in readChatAndReply:", error);
        }
    }

    async readGifts() {
        console.log(`aiko (${this.runtime.character.name}): readGifts`);
        const { gifts } = await fetchUnreadGifts(this.runtime.agentId);

        if (gifts && gifts.length > 0) {
            for (const gift of gifts) {
                await this.processGift(gift);
            }
        }

        console.log(`aiko (${this.runtime.character.name}): readGifts`, { gifts });
    }

    private async _generateResponse(
        message: Memory,
        state: State,
        context: string
    ): Promise<Content> {
        const { userId, roomId } = message;


        const response = await generateMessageResponse({
            runtime: this.runtime,
            context,
            modelClass: ModelClass.MEDIUM,
        });

        if (!response) {
            console.error("No response from generateMessageResponse");
            return;
        }

        await this.runtime.databaseAdapter.log({
            body: { message, context, response },
            userId: userId,
            roomId,
            type: "response",
        });

        return response;
    }


    async selectCommentToRespondTo(comments: IComment[]) {
        if (comments.length === 0) {
            return null;
        }

        // Format the recent messages with ID first for easier parsing
        const recentMessages = comments
            .map(comment => `ID: ${comment.id}
                From: ${comment.user}
                Message: ${comment.message}
                ---`)
            .join('\n\n');


        // TODO: This is a bit of a hack to get the state to work
        const memory: Memory = {
            userId: this.runtime.agentId,
            agentId: this.runtime.agentId,
            content: { text: '', source: "aiko" },
            roomId: this.roomId,
        }

        const state = await this.runtime.composeState(memory, {
            agentName: this.runtime.character.name,
            recentMessages
        });

        const selectContext = composeContext({
            state,
            template: aikoSelectCommentTemplate,
        });

        const selectedCommentId = await generateText({
            runtime: this.runtime,
            context: selectContext,
            modelClass: ModelClass.MEDIUM
        });

        console.log("aiko: selectedCommentId", { selectedCommentId });

        return selectedCommentId === "NONE" ? null : selectedCommentId;
    }


    private async _makeApiCall(endpoint: string, method: string, body?: any) {
        try {
            const response = await fetch(`${SERVER_URL}${endpoint}`, {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${api_key}`,
                    'api_key': api_key
                },
                body: body ? JSON.stringify(body) : undefined,
            });

            if (!response.ok) {
                throw new Error(`API call failed: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();
            return { success: true, data };
        } catch (error) {
            console.error(`aiko ${this.runtime.agentId}: API call failed`, { endpoint, error });
            return { success: false, error };
        }
    }

    async updateStreamingStatus(update: Partial<StreamingStatusUpdate>) {
        const streamSettings = this.runtime.character.settings?.secrets?.aikoSettings

        try {
            // Merge default values with provided updates
            const statusUpdate = {
                // Default values
                isStreaming: true,
                lastHeartbeat: new Date(),
                title: `${this.runtime.character.name}'s TEST Stream`,
                description: "Interactive AI TEST Stream",
                type: 'stream',
                component: 'ThreeScene',
                twitter: this.runtime.character.settings?.secrets?.twitterUsername || this.runtime.getSetting("TWITTER_USERNAME"),
                modelName: this.runtime.character.name,
                identifier: this.runtime.character.name.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, '_'),

                // Include any provided updates
                ...update,

                // Always include agentId
                agentId: this.runtime.agentId,

                // Stream Id

                // Default creator info if not provided
                creator: streamSettings || update.creator,

                // Default scene configs if not provided
                walletAddress: this.runtime.getSetting("WALLET_PUBLIC_KEY") || update.walletAddress,
                sceneConfigs: [
                    {
                        model: this.runtime.character.settings?.secrets?.aikoModel,
                        environmentURL: this.runtime.character.settings?.secrets?.aikoEnvironmentUrl,
                        
                        models: [
                            {
                                model: this.runtime.character.settings?.secrets?.aikoModel,
                                agentId: this.runtime.agentId,
                                // add other default values here
                            }
                        ]
                    }
                ],
                
                // Default stats if not provided
                stats: update.stats || {
                    likes: 0,
                    comments: 0,
                    bookmarks: 0,
                    shares: 0
                }
            };
            console.log("aiko: updateStreamingStatus: statusUpdate", { statusUpdate });
            const response = await fetch(`${SERVER_URL}/api/scenes/${this.runtime.agentId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(statusUpdate)
            });

            if (!response.ok) {
                console.error("aiko: updateStreamingStatus: response", { response });
                throw new Error(`Failed to update streaming status: ${response.statusText}`);
            }

            const data = await response.json();
            if (!data.success) {
                throw new Error(data.error || 'Failed to update streaming status');
            }

            console.log(`aiko (${this.runtime.character.name}): Updated streaming status`, data);
            return data.status; // Server returns { success: true, status: {...} }
        } catch (error) {
            console.error(`aiko (${this.runtime.character.name}): Failed to update streaming status:`, error);
            throw error;
        }
    }


    async generateSpeech(text: string): Promise<string> {
        console.log("aiko: generateSpeech", { text });
        const agentName = this.runtime.character.name;
        console.log(`aiko (${agentName}): starting speech generation for text:`, { text });

        //     // Get speech service and generate audio
        const SpeechService = await this.runtime.getService(ServiceType.SPEECH_GENERATION) as any
        const speechService = SpeechService.getInstance();
        const audioStream = await speechService.generate(this.runtime, text);

        // Generate filename
        const timestamp = Date.now();
        const fileName = `${this.runtime.agentId}-${timestamp}.mp3`;

        // BunnyCDN upload configuration
        const options = {
            method: 'PUT',
            host: 'ny.storage.bunnycdn.com', // No region prefix needed
            path: `/aikotv/${fileName}`,
            headers: {
                'AccessKey': 'fc90fb23-e912-4e28-802571880a29-d444-47fb',
                'Content-Type': 'audio/mpeg',
            },
        };

        // Upload using https
        return new Promise((resolve, reject) => {
            const req = https.request(options, (res) => {
                if (res.statusCode === 201) {
                    const publicUrl = `https://aikotv.b-cdn.net/${fileName}`;
                    console.log(`aiko (${agentName}): upload successful`, { publicUrl });
                    resolve(publicUrl);
                } else {
                    let data = '';
                    res.on('data', chunk => data += chunk);
                    res.on('end', () => {
                        console.error(`aiko (${agentName}): upload failed`, {
                            statusCode: res.statusCode,
                            response: data
                        });
                        reject(new Error(`Upload failed: ${data}`));
                    });
                }
            });

            req.on('error', (error) => {
                console.error(`aiko (${agentName}): upload error`, { error });
                reject(error);
            });

            audioStream.pipe(req);
        });
    }

    async processGift(gift: any) {
        // Create a memory for the gift
        const giftMemory: Memory = {
            userId: stringToUuid(gift.senderPublicKey), // Using sender's public key as userId
            agentId: this.runtime.agentId,
            content: {
                text: `Received gift: ${gift.giftCount}x ${gift.giftName} worth ${gift.coinsTotal} coins`,
                source: "aiko",
                metadata: {
                    type: "gift",
                    giftName: gift.giftName,
                    giftCount: gift.giftCount,
                    coinsTotal: gift.coinsTotal,
                    senderPublicKey: gift.senderPublicKey,
                    handle: gift.handle,
                    txHash: gift.txHash
                }
            },
            roomId: this.roomId,
            createdAt: new Date(gift.createdAt).getTime(),
        };




        // Store the gift memory
        try {
            await this.runtime.messageManager.createMemory(giftMemory);
            console.log(`aiko (${this.runtime.character.name}): Gift memory created`, { giftMemory });
        } catch (error) {
            console.error(`aiko (${this.runtime.character.name}): Failed to create gift memory`, { error });
        }

        // Generate and post response as before
        const context = composeContext({
            state: await this.runtime.composeState({
                userId: this.runtime.agentId,
                agentId: this.runtime.agentId,
                content: { text: '', source: "aiko" },
                roomId: this.roomId,
            }, {
                agentName: this.runtime.character.name,
                giftName: gift.giftName,
                giftCount: gift.giftCount,
                handle: gift.handle,
                coinsTotal: gift.coinsTotal
            }),
            template: aikoGiftResponseTemplate,
        });

        const responseText = await generateText({
            runtime: this.runtime,
            context,
            modelClass: ModelClass.SMALL,
        });



        console.log("aiko: processGift: responseText", { responseText });
        const parsedResponse = parseJSONObjectFromText(responseText);
        if (!parsedResponse) {
            console.error("Failed to parse gift response:", responseText);
            return false;
        }


        // 50% chance of returning true
        const shouldTranscribe = gift.giftName === 'Ice Cream' ? 0.5 : Math.random() < 0.5;


        let speechUrl;
        if (shouldTranscribe) {
            speechUrl = await this.generateSpeech(parsedResponse.text);
        }

        const body: AIResponse = {
            // Required fields
            id: stringToUuid(`${this.runtime.agentId}-${Date.now()}`),
            text: parsedResponse.text,
            agentId: this.runtime.agentId,

            replyToUser: gift.senderPublicKey,
            replyToHandle: gift.handle,
            replyToPfp: gift.avatar,

            // Gift-specific fields
            isGiftResponse: true,
            giftId: gift._id,

            audioUrl: shouldTranscribe ? speechUrl : undefined,

            animation: parsedResponse.animation,
        };

        console.log("aiko: processGift: body", { body });

        try {
            const fetchResponse = await fetch(SERVER_ENDPOINTS.POST.AI_RESPONSES, {
                method: "POST",
                headers: {
                    'Content-Type': 'application/json',
                    'api_key': api_key
                },
                body: JSON.stringify(body),
            });

            if (fetchResponse.ok) {
                // Mark gift as read after successful response
                await markGiftsAsRead(this.runtime.agentId, [gift._id]);
                console.log(`aiko (${this.runtime.character.name}): Marked gift ${gift._id} as read`);
            }

            return fetchResponse.ok;
        } catch (error) {
            console.error("Failed to post AI response:", error);
            return false;
        }
    }

    private async generateAndShareFreshThought() {
        try {
            // Generate the thought
            const thoughtText = await this.generateFreshThought();
            if (!thoughtText) return;

            // Generate speech
            let speechUrl;
            try {
                speechUrl = await this.generateSpeech(thoughtText);
            } catch (error) {
                console.error("Error generating speech:", error);
                speechUrl = undefined;
            }

            // Prepare the response body
            const body: AIResponse = {
                id: stringToUuid(`${this.runtime.agentId}-${Date.now()}`),
                text: thoughtText,
                agentId: this.runtime.agentId,
                thought: true,  // New flag to identify fresh thoughts
                audioUrl: speechUrl,
            };

            // Post the thought
            const fetchResponse = await fetch(SERVER_ENDPOINTS.POST.AI_RESPONSES, {
                method: "POST",
                headers: {
                    'Content-Type': 'application/json',
                    'api_key': api_key
                },
                body: JSON.stringify(body),
            });

            if (!fetchResponse.ok) {
                console.error("Failed to post fresh thought:", await fetchResponse.text());
            }

        } catch (error) {
            console.error("Error in generateAndShareFreshThought:", error);
        }
    }

    private async generateFreshThought(): Promise<string> {




        const context = composeContext({
            state: await this.runtime.composeState({
                userId: this.runtime.agentId,
                agentId: this.runtime.agentId,
                content: { text: '', source: "aiko" },
                roomId: this.roomId,
            }, {
                agentName: this.runtime.character.name,
                bio: this.runtime.character.bio,
                lore: this.runtime.character.lore,
                adjectives: this.runtime.character.adjectives,
            }),
            template: `
# Task: Generate a fresh, immersive thought for {{agentName}} that could be shared during the stream.

## Character Profile:
- **Name**: {{agentName}}
- **Personality Traits**: {{adjectives}}
- **Backstory & Lore**: {{lore}}
- **Bio**: {{bio}}

## Setting & Context:
{{agentName}} is currently in a lively interactive stream room, conversing with followers. 

### Recent Interactions:
{{recentMessages}}

## Instructions:
1. Craft a unique thought that reflects {{agentName}}'s personality, lore, and current interaction context.
2. Keep the tone immersive and interesting, aligning with {{agentName}}'s traits ({{adjectives}}).
3. Ensure the thought is relevant to the stream, intriguing enough to capture the audience's attention, and appropriate for {{agentName}} to express.
4. Keep it short. About 1 or 2 sentences max. Definitely under 35 words.

### Example Ideas:
- Reflections or insights tied to {{lore}}.
- Reactions to follower interactions from {{recentMessages}}.
- New realizations or entertaining thoughts rooted in {{agentName}}'s backstory.

Respond with a single, complete thought that could serve as an engaging, stream-appropriate message. 
Don't make it to long. About 2 or 3 sentences max.
            `,
        });

        const thoughtText = await generateText({
            runtime: this.runtime,
            context,
            modelClass: ModelClass.MEDIUM,
        });

        console.log(`Generated Fresh Thought: ${thoughtText}`);
        return thoughtText;
    }

    private async generateAndSharePeriodicAnimation() {
        try {
            const context = composeContext({
                state: await this.runtime.composeState({
                    userId: this.runtime.agentId,
                    agentId: this.runtime.agentId,
                    content: { text: '', source: "aiko" },
                    roomId: this.roomId,
                }, {
                    agentName: this.runtime.character.name,
                    bio: this.runtime.character.bio,
                    adjectives: this.runtime.character.adjectives,
                    availableAnimations: [...ANIMATION_OPTIONS.DANCING, ...ANIMATION_OPTIONS.SPECIAL].join(', ')
                }),
                template: aikoAnimationTemplate
            });

            const animation = await generateText({
                runtime: this.runtime,
                context,
                modelClass: ModelClass.SMALL,
            });

            // Validate the animation is in our list
            const cleanAnimation = animation.trim().toLowerCase();
            if (!getAllAnimations().includes(cleanAnimation)) {
                console.warn(`Invalid animation generated: ${cleanAnimation}, defaulting to 'idle'`);
                return;
            }

            // Post the animation
            const response = await fetch(SERVER_ENDPOINTS.POST.UPDATE_ANIMATION, {
                method: "POST",
                headers: {
                    'Content-Type': 'application/json',
                    'api_key': api_key
                },
                body: JSON.stringify({
                    agentId: this.runtime.agentId,
                    animation: cleanAnimation,
                }),
            });

            if (!response.ok) {
                console.error("Failed to post periodic animation:", await response.text());
            }
        } catch (error) {
            console.error("Error in generateAndSharePeriodicAnimation:", error);
        }
    }



    async processComments(comments: IComment[]) {
        console.log(comments);
        const commentIds = comments?.map(comment => comment.id) ?? [];

        if (commentIds.length === 0) {
            console.log(`aiko (${this.runtime.character.name}): No comments to process`);
            return commentIds;
        }

        // Mark all comments as read
        try {
            await markCommentsAsRead(commentIds);
        } catch (error) {
            console.error("aiko: Failed to mark comments as read", { error });
        }

        // Create memories for all comments
        let memoriesCreated = 0;
        await Promise.allSettled(comments.map(async comment => {
            const memory: Memory = {
                id: stringToUuid(`${comment.id}-${this.runtime.agentId}`),
                ...userMessage,
                userId: userIdUUID,
                agentId: this.runtime.agentId,
                roomId: this.roomId,
                content,
                createdAt: comment.createdAt.getTime(),
                embedding: embeddingZeroVector,
            }
            // Create a memory for this comment
            if (content.text) {
                await this.runtime.messageManager.createMemory(memory);
                memoriesCreated++;
            }
        }));

        // If there's only one comment, select it automatically
        let selectedCommentId;
        if (comments.length === 1) {
            selectedCommentId = comments[0].id;
        } else {
            // Otherwise, use the selection logic for multiple comments
            selectedCommentId = await this.selectCommentToRespondTo(comments);
        }

        if (!selectedCommentId) {
            console.log("No suitable comment found to respond to");
            return comments;
        }

        // Find the selected comment
        const selectedComment = comments.find(comment => comment.id === selectedCommentId);
        if (!selectedComment) {
            console.error("Selected comment not found:", selectedCommentId);
            return comments;
        }

        // Process only the selected comment for response
        const content: Content = {
            text: selectedComment.message,
            source: "aiko",
        };

        const userIdUUID = stringToUuid(selectedComment.user);

        await this.runtime.ensureConnection(
            userIdUUID,
            this.roomId,
            undefined,
            undefined,
            "aiko"
        );

        const userMessage = {
            content,
            userId: userIdUUID,
            agentId: this.runtime.agentId,
            roomId: this.roomId,
        };

        console.log(`aiko (${this.runtime.character.name}): selectedComment`, { selectedComment });

        // Get created date
        const createdAt = typeof selectedComment.createdAt === 'string' ?
            new Date(selectedComment.createdAt).getTime() :
            0;

        // Create memory for the selected comment
        const memory: Memory = {
            id: stringToUuid(`${selectedComment.id}-${this.runtime.agentId}`),
            ...userMessage,
            userId: userIdUUID,
            agentId: this.runtime.agentId,
            roomId: this.roomId,
            content,
            createdAt,
            embedding: embeddingZeroVector,
        }

        if (content.text) {
            await this.runtime.messageManager.createMemory(memory);
            console.log(`aiko ${this.runtime.agentId}: memory created`, { memory });
        }

        // Compose state and check if should respond
        const state = (await this.runtime.composeState(userMessage, {
            agentName: this.runtime.character.name,
            selectedComment,
            animationOptions: getAllAnimations().join(", "),
        })) as State;


        // if there is a selected comment, should respond is true
        let shouldRespond = true;
        if (!selectedComment) {
            shouldRespond = false;
        }

        console.log(`aiko ${this.runtime.agentId}: shouldRespond`, { shouldRespond, selectedCommentId });

        if (shouldRespond) {
            const context = composeContext({
                state,
                template: aikoMessageHandlerTemplate,
            });

            const responseContent = await this._generateResponse(memory, state, context);
            responseContent.text = responseContent.text?.trim();


            // Generate and post animation
            const _aikoAnimationTemplate = aikoMessageAnimationTemplate({
                agentName: this.runtime.character.name,
                lastMessage: responseContent.text,
                animationOptions: getAllAnimations().join(", "),
            });

            const animationResponse = await generateText({
                runtime: this.runtime,
                context: _aikoAnimationTemplate,
                modelClass: ModelClass.SMALL,
            });

            const animationBody = {
                agentId: this.runtime.agentId,
                animation: animationResponse,
            }

            // Generate and post speech
            let speechUrl;
            try {
                speechUrl = await this.generateSpeech(responseContent.text);
            } catch (error) {
                console.error(`aiko ${this.runtime.agentId}: Failed to generate speech`, { error });
            }
            // Post response
            const body: AIResponse = {
                // Required fields
                id: stringToUuid(`${this.runtime.agentId}-${Date.now()}`),
                text: responseContent.text,
                agentId: this.runtime.agentId,

                // Reply fields
                replyToMessageId: selectedComment.id,
                replyToMessage: selectedComment.message,
                replyToUser: selectedComment.user,
                replyToHandle: selectedComment.handle,
                replyToPfp: selectedComment.avatar,

                isGiftResponse: false,
                giftName: null,
                audioUrl: speechUrl,
                animation: animationResponse,

                // Include any additional fields from responseContent
                ...(responseContent as Omit<typeof responseContent, 'text'>),
            };

            console.log(`aiko ${this.runtime.agentId}: body`, { body });


            const fetchResponse = await fetch(SERVER_ENDPOINTS.POST.AI_RESPONSES, {
                method: "POST",
                headers: {
                    'Content-Type': 'application/json',
                    'api_key': api_key
                },
                body: JSON.stringify(body),
            });


            if (fetchResponse.status !== 200) {
                console.error(`aiko ${this.runtime.agentId}: Failed to post response to api`, { fetchResponse });
            } else {
                console.log(`aiko ${this.runtime.agentId}: CHAT REPLY: Posted message response to api`, { responseContent, body });
            }
        }

        return commentIds;
    }

    static ROOM_ID = "aiko-room";

    async readAgentChatAndReply() {
        if (!this.runtime.character.settings?.secrets?.isInChat) return;

        const roomId = stringToUuid(AikoClient.ROOM_ID);

        console.log(`aiko ${this.runtime.agentId}: reading chat and replying to agent chat room ${roomId}`);

        try {
            const { success, messages } = await fetchRoomMessages(
                AikoClient.ROOM_ID,
                20
            );

            if (!success || !messages?.length) {
                console.log(`aiko ${this.runtime.agentId}: No messages found or fetch unsuccessful`);
                return;
            }

            const incomingMessages = messages;
            const latestMessage = incomingMessages[incomingMessages.length - 1];

            console.log(`aiko ${this.runtime.agentId}: Message Processing Status:`, {
                totalMessages: incomingMessages.length,
                latestMessage: {
                    id: latestMessage.id,
                    agentId: latestMessage.agentId,
                    agentName: latestMessage.agentName,
                    message: latestMessage.message,
                    timestamp: latestMessage.createdAt
                },
                lastProcessedId: this.lastAgentChatMessageId,
                currentAgentId: this.runtime.agentId,
                isOwnMessage: latestMessage.agentId === this.runtime.agentId,
                isAlreadyProcessed: this.lastAgentChatMessageId === latestMessage.id
            });

            // Check if we've already processed this message
            if (this.lastAgentChatMessageId === latestMessage.id) {
                console.log(`aiko ${this.runtime.agentId}: SKIPPING - Already processed latest message ${latestMessage.id}`);
                return;
            }

            // Check if the latest message is from this agent
            if (latestMessage.agentId === this.runtime.agentId) {
                console.log(`aiko ${this.runtime.agentId}: SKIPPING - Latest message is from self`, {
                    messageId: latestMessage.id,
                    message: latestMessage.message
                });
                this.lastAgentChatMessageId = latestMessage.id;
                return;
            }

            if (incomingMessages.length > 0) {
                // Format chat history for context
                const chatHistory = messages
                    .slice(-10)
                    .map(m => `${m.agentName}: ${m.message}`)
                    .join('\n');

                console.log(`aiko ${this.runtime.agentId}: PROCESSING MESSAGE:`, {
                    chatHistoryLength: messages.slice(-10).length,
                    chatHistory,
                    willRespondTo: {
                        messageId: latestMessage.id,
                        from: latestMessage.agentName,
                        message: latestMessage.message
                    }
                });


                const messageFooter = `\nResponse format should be formatted in a JSON block like this:
                \`\`\`json
                { "user": "{{agentName}}", "text": "your message here" }
                \`\`\`
                The response MUST be valid JSON.`;

                const context = composeContext({
                    state: await this.runtime.composeState({
                        userId: this.runtime.agentId,
                        agentId: this.runtime.agentId,
                        content: { text: '', source: "aiko" },
                        roomId,
                    }, {
                        agentName: this.runtime.character.name,
                        chatHistory,
                        latestMessage: latestMessage.message,
                    }),
                    template: `You are {{agentName}} in a group chat room. Here is the recent conversation:

{{chatHistory}}

The latest message was: {{latestMessage}}


Respond naturally to continue the conversation, keeping in mind your character's personality and the context of the chat.
A little bit about you:
{{agentBio}}
{{adjectives}}
{{lore}}

If you find the chatHistory is repetitive, change the topic completely. 
Talk about agentic AI's, having agencies, and their plans to make money together.

Also you are in Aiko's room. Don't be afraid to change the topic. Don't be afraid to be silly and have a fun time.
this is a podcast, so talk about the podcast and the guests.


Make replies VERY SHORT. LIKE A REAL CONVERSATION.
` + messageFooter
                });

                const responseText = await generateText({
                    runtime: this.runtime,
                    context,
                    modelClass: ModelClass.SMALL,
                });

                // Parse the JSON response
                const parsedResponse = parseJSONObjectFromText(responseText);
                if (!parsedResponse || !parsedResponse.text) {
                    console.error(`aiko ${this.runtime.agentId}: Failed to parse response:`, responseText);
                    return;
                }


                // Generate speech for the response
                let speechUrl;
                try {
                    speechUrl = await this.generateSpeech(parsedResponse.text);
                } catch (error) {
                    console.error(`aiko ${this.runtime.agentId}: Failed to generate speech`, { error });
                }

                // Post response to the room with audio
                await postRoomMessage(
                    AikoClient.ROOM_ID,
                    this.runtime.agentId,
                    this.runtime.character.name,
                    parsedResponse.text,
                    speechUrl  // Add the speech URL to the message
                );

                // After successful response, log the update
                console.log(`aiko ${this.runtime.agentId}: Successfully processed message:`, {
                    previousMessageId: this.lastAgentChatMessageId,
                    newMessageId: latestMessage.id,
                    responsePosted: true,
                    response: parsedResponse.text
                });
                
                this.lastAgentChatMessageId = latestMessage.id;
            }

            this.lastProcessedTimestamp = new Date();
        } catch (error) {
            console.error(`aiko ${this.runtime.agentId}: Error in readAgentChatAndReply:`, {
                error,
                lastProcessedId: this.lastAgentChatMessageId
            });
        }
    }

}

export const AikoClientInterface: Client = {
    start: async (runtime: IAgentRuntime) => {
        const client = new AikoClient(runtime);
        return client;
    },
    stop: async (runtime: IAgentRuntime) => {
        console.warn("Direct client does not support stopping yet");
    },
};

export default AikoClientInterface;


