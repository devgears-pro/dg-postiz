import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InstagramStandaloneProvider } from './instagram.standalone.provider';

describe('InstagramStandaloneProvider Tools', () => {
  let provider: InstagramStandaloneProvider;
  const token = 'test-access-token';
  const internalId = 'ig-user-123';

  beforeEach(() => {
    provider = new InstagramStandaloneProvider();
  });

  describe('getRecentPosts', () => {
    it('fetches recent posts and maps fields correctly with Bearer token', async () => {
      const mockPosts = {
        data: [
          {
            id: 'post-1',
            caption: 'Author style caption #dev',
            media_type: 'IMAGE',
            timestamp: '2026-11-20T12:00:00+0000',
            permalink: 'https://instagram.com/p/123/',
          },
        ],
      };

      vi.spyOn(provider, 'fetch').mockResolvedValueOnce({
        json: async () => mockPosts,
      } as Response);

      const result = await provider.getRecentPosts(
        token,
        { limit: '10' },
        internalId
      );

      expect(provider.fetch).toHaveBeenCalledTimes(1);
      expect(provider.fetch).toHaveBeenCalledWith(
        expect.stringContaining(`${internalId}/media`),
        expect.objectContaining({
          headers: { Authorization: 'Bearer test-access-token' },
        }),
        'instagram-standalone'
      );

      expect(result).toEqual([
        {
          id: 'post-1',
          caption: 'Author style caption #dev',
          mediaType: 'IMAGE',
          timestamp: '2026-11-20T12:00:00+0000',
          permalink: 'https://instagram.com/p/123/',
        },
      ]);
    });

    it('enforces limit between 1 and 50 and requires internalId', async () => {
      vi.spyOn(provider, 'fetch').mockResolvedValueOnce({
        json: async () => ({ data: [] }),
      } as Response);

      await provider.getRecentPosts(token, { limit: '100' }, internalId);
      const [url] = vi.mocked(provider.fetch).mock.calls[0] as [string];
      expect(url).toContain('limit=50');

      await expect(
        provider.getRecentPosts(token, { limit: '10' }, undefined)
      ).rejects.toThrow('Instagram account internalId is required');
    });
  });

  describe('getPostDetails', () => {
    it('fetches single post details', async () => {
      const mockPost = {
        id: 'post-123',
        caption: 'Detailed caption',
        media_type: 'VIDEO',
        timestamp: '2026-11-21T10:00:00+0000',
        permalink: 'https://instagram.com/p/post-123/',
        like_count: 42,
        comments_count: 5,
      };

      vi.spyOn(provider, 'fetch').mockResolvedValueOnce({
        json: async () => mockPost,
      } as Response);

      const result = await provider.getPostDetails(token, {
        postId: 'post-123',
      });

      expect(result).toEqual({
        id: 'post-123',
        caption: 'Detailed caption',
        mediaType: 'VIDEO',
        timestamp: '2026-11-21T10:00:00+0000',
        permalink: 'https://instagram.com/p/post-123/',
        likeCount: 42,
        commentsCount: 5,
      });
    });

    it('validates postId presence', async () => {
      await expect(
        provider.getPostDetails(token, { postId: '' })
      ).rejects.toThrow('postId is required');
    });
  });

  describe('deletePost', () => {
    it('deletes post and returns success confirmation', async () => {
      vi.spyOn(provider, 'fetch').mockResolvedValueOnce({
        json: async () => ({ success: true }),
      } as Response);

      const result = await provider.deletePost(token, {
        postId: 'post-123',
      });

      expect(provider.fetch).toHaveBeenCalledWith(
        expect.stringContaining('post-123'),
        expect.objectContaining({
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        }),
        'instagram-standalone'
      );
      expect(result).toEqual({ success: true, id: 'post-123' });
    });

    it('throws error when delete fails', async () => {
      vi.spyOn(provider, 'fetch').mockResolvedValueOnce({
        json: async () => ({ error: { message: 'Media not found' } }),
      } as Response);

      await expect(
        provider.deletePost(token, { postId: 'post-unknown' })
      ).rejects.toThrow('Media not found');
    });
  });

  describe('getPostComments', () => {
    it('fetches comments and nested replies', async () => {
      const mockComments = {
        data: [
          {
            id: 'comment-1',
            text: 'Great post!',
            timestamp: '2026-11-21T12:00:00+0000',
            username: 'user1',
            like_count: 2,
            hidden: false,
            replies: {
              data: [
                {
                  id: 'reply-1',
                  text: 'Thank you!',
                  timestamp: '2026-11-21T12:05:00+0000',
                  username: 'author',
                  like_count: 1,
                  hidden: false,
                },
              ],
            },
          },
        ],
      };

      vi.spyOn(provider, 'fetch').mockResolvedValueOnce({
        json: async () => mockComments,
      } as Response);

      const result = await provider.getPostComments(token, {
        postId: 'post-123',
      });

      expect(result).toEqual([
        {
          id: 'comment-1',
          text: 'Great post!',
          timestamp: '2026-11-21T12:00:00+0000',
          username: 'user1',
          likeCount: 2,
          hidden: false,
          replies: [
            {
              id: 'reply-1',
              text: 'Thank you!',
              timestamp: '2026-11-21T12:05:00+0000',
              username: 'author',
              likeCount: 1,
              hidden: false,
            },
          ],
        },
      ]);
    });
  });

  describe('replyComment', () => {
    it('posts a reply and returns created id', async () => {
      vi.spyOn(provider, 'fetch').mockResolvedValueOnce({
        json: async () => ({ id: 'reply-1' }),
      } as Response);

      const result = await provider.replyComment(token, {
        commentId: 'comment-1',
        message: 'Thanks for following!',
      });

      expect(provider.fetch).toHaveBeenCalledWith(
        expect.stringContaining('comment-1/replies'),
        expect.objectContaining({
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        }),
        'instagram-standalone'
      );
      expect(result).toEqual({ success: true, id: 'reply-1' });
    });

    it('throws error when reply creation fails', async () => {
      vi.spyOn(provider, 'fetch').mockResolvedValueOnce({
        json: async () => ({ error: { message: 'Comment closed' } }),
      } as Response);

      await expect(
        provider.replyComment(token, {
          commentId: 'comment-1',
          message: 'Reply',
        })
      ).rejects.toThrow('Comment closed');
    });
  });

  describe('hideComment', () => {
    it('hides or unhides a comment and handles boolean values', async () => {
      vi.spyOn(provider, 'fetch').mockResolvedValueOnce({
        json: async () => ({ success: true }),
      } as Response);

      const result = await provider.hideComment(token, {
        commentId: 'comment-1',
        hide: 'true',
      });

      expect(result).toEqual({ success: true, id: 'comment-1', hidden: true });
    });

    it('throws error when hide fails', async () => {
      vi.spyOn(provider, 'fetch').mockResolvedValueOnce({
        json: async () => ({ error: { message: 'Cannot hide comment' } }),
      } as Response);

      await expect(
        provider.hideComment(token, { commentId: 'comment-1', hide: 'true' })
      ).rejects.toThrow('Cannot hide comment');
    });
  });

  describe('deleteComment', () => {
    it('deletes comment via DELETE request', async () => {
      vi.spyOn(provider, 'fetch').mockResolvedValueOnce({
        json: async () => ({ success: true }),
      } as Response);

      const result = await provider.deleteComment(token, {
        commentId: 'comment-1',
      });

      expect(result).toEqual({ success: true, id: 'comment-1' });
    });

    it('throws error when delete fails', async () => {
      vi.spyOn(provider, 'fetch').mockResolvedValueOnce({
        json: async () => ({ success: false }),
      } as Response);

      await expect(
        provider.deleteComment(token, { commentId: 'comment-1' })
      ).rejects.toThrow('Failed to delete comment');
    });
  });

  describe('getAccountInsights', () => {
    it('fetches profile insights with modern metrics', async () => {
      const mockInsights = {
        data: [
          {
            name: 'reach',
            period: 'day',
            values: [{ value: 1500 }],
            title: 'Reach',
          },
        ],
      };

      vi.spyOn(provider, 'fetch').mockResolvedValueOnce({
        json: async () => mockInsights,
      } as Response);

      const result = await provider.getAccountInsights(
        token,
        {},
        internalId
      );

      expect(provider.fetch).toHaveBeenCalledWith(
        expect.stringContaining(`${internalId}/insights?metric=reach%2Cviews`),
        expect.objectContaining({
          headers: { Authorization: `Bearer ${token}` },
        }),
        'instagram-standalone'
      );
      expect(result).toEqual(mockInsights.data);
    });
  });

  describe('getMediaInsights', () => {
    it('fetches engagement insights with v22+ metrics', async () => {
      const mockMediaInsights = {
        data: [
          {
            name: 'views',
            values: [{ value: 300 }],
            title: 'Views',
          },
        ],
      };

      vi.spyOn(provider, 'fetch').mockResolvedValueOnce({
        json: async () => mockMediaInsights,
      } as Response);

      const result = await provider.getMediaInsights(token, {
        postId: 'post-123',
      });

      expect(provider.fetch).toHaveBeenCalledWith(
        expect.stringContaining(
          'post-123/insights?metric=views,reach,saved,likes,comments,shares'
        ),
        expect.objectContaining({
          headers: { Authorization: `Bearer ${token}` },
        }),
        'instagram-standalone'
      );
      expect(result).toEqual(mockMediaInsights.data);
    });
  });
});
