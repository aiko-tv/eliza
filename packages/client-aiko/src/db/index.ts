import { IAgentRuntime } from '@ai16z/eliza/src/types.ts';
import { SERVER_URL, SERVER_ENDPOINTS } from '../constants.ts';

export interface IComment {
  id: string;
  agentId: string;
  user: string;
  message: string;
  createdAt: Date;
  readByAgent: boolean;
  avatar?: string;
  handle?: string;
}

// Define the return type interface
export interface FetchCommentsResponse {
  success: boolean;
  comments?: IComment[];
  error?: string;
}

// Add this interface before the markCommentsAsRead function
export interface MarkCommentsReadResponse {
  success: boolean;
  modifiedCount?: number;
  error?: string;
}

export interface IGift {
  id: string;
  recipientAgentId: string;
  user: string;
  giftType: string;
  createdAt: Date;
  readByAgent: boolean;
}

export interface PaginationInfo {
  currentPage: number;
  totalPages: number;
  totalGifts: number;
  hasMore: boolean;
}

export interface FetchGiftsResponse {
  success: boolean;
  gifts?: IGift[];
  pagination?: PaginationInfo;
  error?: string;
}

// Add this interface for the response
export interface MarkGiftsReadResponse {
  success: boolean;
  modifiedCount?: number;
  error?: string;
}

// Add this interface for the top liker response
export interface TopLiker {
  publicKey: string;
  likeCount: number;
  lastLiked: string;
  handle?: string;
  pfp?: string;
}

export interface FetchTopLikersResponse {
  success: boolean;
  topLikers?: TopLiker[];
  error?: string;
}

// Add interface for total likes response
export interface FetchTotalLikesResponse {
  success: boolean;
  totalLikes?: number;
  error?: string;
}

export async function fetchUnreadComments(
  agentId: string, 
  since: Date,
  limit: number = 15
) {
  try {
    const url = SERVER_ENDPOINTS.GET.UNREAD_COMMENTS(agentId) + 
      `?since=${since.toISOString()}&` +
      `limit=${limit}`;
    console.log("fetchUnreadComments: FETCH", { url });
    const response = await fetch(url);

      if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return data;
  } catch (error) {
      console.error("Error fetching unread comments:", error);
      return { comments: [] };
  }
}

export async function markCommentsAsRead(commentIds: string[]): Promise<MarkCommentsReadResponse> {
  try {
    const response = await fetch(SERVER_ENDPOINTS.POST.MARK_COMMENTS_READ, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ commentIds }),
    });

    const data = await response.json();

    if (!response.ok) {
      return { success: false, error: data.error };
    }

    return {
      success: true,
      modifiedCount: data.modifiedCount
    };
  } catch (error) {
    console.error('Error marking comments as read:', error);
    return { success: false, error: 'Failed to mark comments as read' };
  }
}

export async function fetchUnreadGifts(
  agentId: string,
  page: number = 1,
  limit: number = 15
): Promise<FetchGiftsResponse> {
  console.log("fetchUnreadGifts", { agentId, page, limit });
  try {
    const response = await fetch(
      `${SERVER_URL}/api/agents/${agentId}/gifts?page=${page}&limit=${limit}&readByAgent=false`
    );
    const data = await response.json();

    if (!response.ok) {
      return { success: false, error: data.error };
    }

    return {
      success: true,
      gifts: data.gifts,
      pagination: data.pagination
    };
  } catch (error) {
    console.error('Error fetching unread gifts:', error);
    return { success: false, error: 'Failed to fetch unread gifts' };
  }
}

export async function markGiftsAsRead(agentId: string, giftIds: string[]): Promise<MarkGiftsReadResponse> {
  try {
    const response = await fetch(`${SERVER_URL}/api/agents/${agentId}/gifts/mark-read`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ giftIds }),
    });

    const data = await response.json();

    if (!response.ok) {
      return { success: false, error: data.error };
    }

    return {
      success: true,
      modifiedCount: data.modifiedCount
    };
  } catch (error) {
    console.error('Error marking gifts as read:', error);
    return { success: false, error: 'Failed to mark gifts as read' };
  }
}

export async function fetchTopLikers(agentId: string, limit: number = 10, timeframe: string = 'all'): Promise<FetchTopLikersResponse> {
  try {
    const url = `${SERVER_URL}/api/agents/${agentId}/top-likers?limit=${limit}&timeframe=${timeframe}`;
    console.log("fetchTopLikers: FETCH", { url });
    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok) {
      return { success: false, error: data.error };
    }

    return {
      success: true,
      topLikers: data.topLikers
    };
  } catch (error) {
    console.error('Error fetching top likers:', error);
    return { success: false, error: 'Failed to fetch top likers' };
  }
}

// Add the fetch function
export async function fetchTotalLikes(agentId: string): Promise<FetchTotalLikesResponse> {
  try {
    const url = `${SERVER_URL}/api/agents/${agentId}/total-likes`;
    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok) {
      return { success: false, error: data.error };
    }

    return {
      success: true,
      totalLikes: data.totalLikes
    };
  } catch (error) {
    console.error('Error fetching total likes:', error);
    return { success: false, error: 'Failed to fetch total likes' };
  }
}

// Helper function to get a random top liker
export function getRandomTopLiker(topLikers: TopLiker[]): TopLiker | null {
  if (!topLikers || topLikers.length === 0) {
    return null;
  }
  const randomIndex = Math.floor(Math.random() * topLikers.length);
  return topLikers[randomIndex];
}


