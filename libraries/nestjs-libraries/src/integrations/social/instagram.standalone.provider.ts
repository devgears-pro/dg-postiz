import {
  AuthTokenDetails,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { makeSecureId } from '@gitroom/nestjs-libraries/services/make.secure.id';
import dayjs from 'dayjs';
import {
  SocialAbstract,
  ValidityMedia,
} from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { InstagramDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/instagram.dto';
import { InstagramProvider } from '@gitroom/nestjs-libraries/integrations/social/instagram.provider';
import { META_GRAPH_API_VERSION } from '@gitroom/nestjs-libraries/integrations/social/facebook.provider';
import { Integration } from '@prisma/client';
import { Rules } from '@gitroom/nestjs-libraries/chat/rules.description.decorator';
import { Tool } from '@gitroom/nestjs-libraries/integrations/tool.decorator';

const instagramProvider = new InstagramProvider();

@Rules(
  [
    "Instagram should have at least one attachment, if it's a story, it can have only one picture.",
    'If the content of the post (text, pictures or video) was made with AI, ask the user if they want to mark it as AI, and set made_with_ai to true only when they say yes.',
  ].join(' ')
)
export class InstagramStandaloneProvider
  extends SocialAbstract
  implements SocialProvider
{
  identifier = 'instagram-standalone';
  name = 'Instagram\n(Standalone)';
  isBetweenSteps = false;
  refreshCron = true;
  scopes = [
    'instagram_business_basic',
    'instagram_business_content_publish',
    'instagram_business_manage_comments',
    'instagram_business_manage_insights',
  ];
    override maxConcurrentJob = 200; // Instagram standalone has stricter limits
  dto = InstagramDto;

  editor = 'normal' as const;
  maxLength() {
    return 2200;
  }

  override async checkValidity(
    [firstPost]: Array<ValidityMedia[]>,
    settings: any
  ): Promise<string | true> {
    if (!firstPost?.length) {
      return 'Should have at least one media';
    }
    if (firstPost.length > 20) {
      return 'Instagram carousel only supports up to 20 media attachments';
    }
    if (this.assetBoolean(settings?.is_trial_reel)) {
      if ((firstPost?.length ?? 0) > 1) {
        return 'Trial Reels can only have one video';
      }
      const hasVideo = firstPost?.some(
        (f) => (f?.path?.indexOf?.('mp4') ?? -1) > -1
      );
      if (!hasVideo) {
        return 'Trial Reels must be a video';
      }
    }
    if (firstPost?.some((f) => (f?.alt?.length ?? 0) > 1000)) {
      return 'Instagram alt text can be up to 1000 characters';
    }
    return true;
  }

  public override handleErrors(
    body: string,
    status: number
  ):
    | {
        type: 'refresh-token' | 'bad-body' | 'retry' | 'disconnect';
        value: string;
      }
    | undefined {
    return instagramProvider.handleErrors(body, status);
  }

  async refreshToken(refresh_token: string): Promise<AuthTokenDetails> {
    const { access_token } = await (
      await fetch(
        `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${refresh_token}`
      )
    ).json();

    const {
      user_id,
      name,
      username,
      profile_picture_url = '',
    } = await (
      await fetch(
        `https://graph.instagram.com/${META_GRAPH_API_VERSION}/me?fields=user_id,username,name,profile_picture_url&access_token=${access_token}`
      )
    ).json();

    return {
      id: user_id,
      name,
      accessToken: access_token,
      refreshToken: access_token,
      expiresIn: dayjs().add(58, 'days').unix() - dayjs().unix(),
      picture: profile_picture_url || '',
      username,
    };
  }

  async generateAuthUrl() {
    const state = makeSecureId(6);
    return {
      url:
        `https://www.instagram.com/oauth/authorize?enable_fb_login=0&client_id=${
          process.env.INSTAGRAM_APP_ID
        }&redirect_uri=${encodeURIComponent(
          `${
            process?.env.FRONTEND_URL?.indexOf('https') == -1
              ? `https://redirectmeto.com/${process?.env.FRONTEND_URL}`
              : `${process?.env.FRONTEND_URL}`
          }/integrations/social/instagram-standalone`
        )}&response_type=code&scope=${encodeURIComponent(
          this.scopes.join(',')
        )}` + `&state=${state}`,
      codeVerifier: makeSecureId(10),
      state,
    };
  }

  async authenticate(params: {
    code: string;
    codeVerifier: string;
    refresh: string;
  }) {
    const formData = new FormData();
    formData.append('client_id', process.env.INSTAGRAM_APP_ID!);
    formData.append('client_secret', process.env.INSTAGRAM_APP_SECRET!);
    formData.append('grant_type', 'authorization_code');
    formData.append(
      'redirect_uri',
      `${
        process?.env.FRONTEND_URL?.indexOf('https') == -1
          ? `https://redirectmeto.com/${process?.env.FRONTEND_URL}`
          : `${process?.env.FRONTEND_URL}`
      }/integrations/social/instagram-standalone`
    );
    formData.append('code', params.code);

    const getAccessToken = await (
      await fetch('https://api.instagram.com/oauth/access_token', {
        method: 'POST',
        body: formData,
      })
    ).json();

    if (!getAccessToken.access_token) {
      console.error(
        'Instagram standalone token exchange failed:',
        JSON.stringify(getAccessToken)
      );
      throw new Error(
        getAccessToken.error_message || 'Instagram token exchange failed'
      );
    }

    const { access_token, expires_in, ...all } = await (
      await fetch(
        'https://graph.instagram.com/access_token' +
          '?grant_type=ig_exchange_token' +
          `&client_id=${process.env.INSTAGRAM_APP_ID}` +
          `&client_secret=${process.env.INSTAGRAM_APP_SECRET}` +
          `&access_token=${getAccessToken.access_token}`
      )
    ).json();

    try {
      this.checkScopes(this.scopes, getAccessToken.permissions);
    } catch (err) {
      const { access_token: shortLivedToken, ...exchange } = getAccessToken;
      console.error(
        'Instagram standalone scope check failed:',
        JSON.stringify({
          ...exchange,
          longLived: { hasToken: !!access_token, expires_in, ...all },
        })
      );
      throw err;
    }

    const { user_id, name, username, profile_picture_url } = await (
      await fetch(
        `https://graph.instagram.com/${META_GRAPH_API_VERSION}/me?fields=user_id,username,name,profile_picture_url&access_token=${access_token}`
      )
    ).json();

    return {
      id: user_id,
      name,
      accessToken: access_token,
      refreshToken: access_token,
      expiresIn: dayjs().add(58, 'days').unix() - dayjs().unix(),
      picture: profile_picture_url,
      username,
    };
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails<InstagramDto>[],
    integration: Integration
  ): Promise<PostResponse[]> {
    return instagramProvider.post(
      id,
      accessToken,
      postDetails,
      integration,
      'graph.instagram.com'
    );
  }

  async postPending(
    id: string,
    accessToken: string,
    postDetails: PostDetails<InstagramDto>[],
    integration: Integration
  ): Promise<PostResponse[]> {
    return instagramProvider.postPending(
      id,
      accessToken,
      postDetails,
      integration,
      'graph.instagram.com'
    );
  }

  // the graph domain travels inside pendingData, so these are pure delegations
  override async checkPostStatus(
    accessToken: string,
    pendingData: any,
    integration: Integration
  ) {
    return instagramProvider.checkPostStatus(
      accessToken,
      pendingData,
      integration
    );
  }

  override async finalizePost(
    accessToken: string,
    pendingData: any,
    integration: Integration
  ) {
    return instagramProvider.finalizePost(accessToken, pendingData, integration);
  }

  async comment(
    id: string,
    postId: string,
    lastCommentId: string | undefined,
    accessToken: string,
    postDetails: PostDetails<InstagramDto>[],
    integration: Integration
  ): Promise<PostResponse[]> {
    return instagramProvider.comment(
      id,
      postId,
      lastCommentId,
      accessToken,
      postDetails,
      integration,
      'graph.instagram.com'
    );
  }

  async analytics(id: string, accessToken: string, date: number) {
    return instagramProvider.analytics(
      id,
      accessToken,
      date,
      'graph.instagram.com'
    );
  }

  async postAnalytics(
    integrationId: string,
    accessToken: string,
    postId: string,
    date: number
  ) {
    return instagramProvider.postAnalytics(
      integrationId,
      accessToken,
      postId,
      date,
      'graph.instagram.com'
    );
  }

  @Tool({
    description:
      'Fetch recent published posts with captions from the Instagram account',
    dataSchema: [
      {
        key: 'limit',
        type: 'string',
        description: 'Number of posts to fetch (default 20, max 50)',
      },
    ],
  })
  async getRecentPosts(
    token: string,
    data: { limit?: string },
    internalId?: string
  ) {
    if (!internalId) {
      throw new Error('Instagram account internalId is required');
    }
    const limit = Math.min(Math.max(Number(data?.limit) || 20, 1), 50);
    const response = await (
      await this.fetch(
        `https://graph.instagram.com/${META_GRAPH_API_VERSION}/${encodeURIComponent(internalId)}/media?fields=id,caption,media_type,timestamp,permalink&limit=${limit}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
        this.identifier
      )
    ).json();

    return (response?.data || []).map((post: any) => ({
      id: post.id,
      caption: post.caption || '',
      mediaType: post.media_type,
      timestamp: post.timestamp,
      permalink: post.permalink,
    }));
  }

  @Tool({
    description:
      'Fetch detailed information and reaction counts for a specific Instagram post',
    dataSchema: [
      {
        key: 'postId',
        type: 'string',
        description: 'ID of the Instagram post',
      },
    ],
  })
  async getPostDetails(token: string, data: { postId: string }) {
    if (!data?.postId) {
      throw new Error('postId is required');
    }
    const response = await (
      await this.fetch(
        `https://graph.instagram.com/${META_GRAPH_API_VERSION}/${encodeURIComponent(data.postId)}?fields=id,caption,media_type,timestamp,permalink,like_count,comments_count`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
        this.identifier
      )
    ).json();

    return {
      id: response.id,
      caption: response.caption || '',
      mediaType: response.media_type,
      timestamp: response.timestamp,
      permalink: response.permalink,
      likeCount: response.like_count ?? 0,
      commentsCount: response.comments_count ?? 0,
    };
  }

  @Tool({
    description: 'Delete a published post from the Instagram account',
    dataSchema: [
      {
        key: 'postId',
        type: 'string',
        description: 'ID of the Instagram post to delete',
      },
    ],
  })
  async deletePost(token: string, data: { postId: string }) {
    if (!data?.postId) {
      throw new Error('postId is required');
    }
    const response = await (
      await this.fetch(
        `https://graph.instagram.com/${META_GRAPH_API_VERSION}/${encodeURIComponent(data.postId)}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        },
        this.identifier
      )
    ).json();

    if (response?.error || response?.success === false) {
      throw new Error(
        response?.error?.message || 'Failed to delete Instagram post'
      );
    }

    return { success: true, id: data.postId };
  }

  @Tool({
    description: 'Fetch comments and nested replies for an Instagram post',
    dataSchema: [
      {
        key: 'postId',
        type: 'string',
        description: 'ID of the Instagram post',
      },
    ],
  })
  async getPostComments(token: string, data: { postId: string }) {
    if (!data?.postId) {
      throw new Error('postId is required');
    }
    const response = await (
      await this.fetch(
        `https://graph.instagram.com/${META_GRAPH_API_VERSION}/${encodeURIComponent(data.postId)}/comments?fields=id,text,timestamp,username,like_count,hidden,replies{id,text,timestamp,username,like_count,hidden}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
        this.identifier
      )
    ).json();

    return (response?.data || []).map((comment: any) => ({
      id: comment.id,
      text: comment.text || '',
      timestamp: comment.timestamp,
      username: comment.username,
      likeCount: comment.like_count ?? 0,
      hidden: comment.hidden ?? false,
      replies: (comment.replies?.data || []).map((reply: any) => ({
        id: reply.id,
        text: reply.text || '',
        timestamp: reply.timestamp,
        username: reply.username,
        likeCount: reply.like_count ?? 0,
        hidden: reply.hidden ?? false,
      })),
    }));
  }

  @Tool({
    description: 'Reply to a comment on an Instagram post',
    dataSchema: [
      {
        key: 'commentId',
        type: 'string',
        description: 'ID of the comment to reply to',
      },
      {
        key: 'message',
        type: 'string',
        description: 'Text of the reply',
      },
    ],
  })
  async replyComment(
    token: string,
    data: { commentId: string; message: string }
  ) {
    if (!data?.commentId || !data?.message) {
      throw new Error('commentId and message are required');
    }
    const body = new URLSearchParams();
    body.append('message', data.message);

    const response = await (
      await this.fetch(
        `https://graph.instagram.com/${META_GRAPH_API_VERSION}/${encodeURIComponent(data.commentId)}/replies`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body,
        },
        this.identifier
      )
    ).json();

    if (!response?.id) {
      throw new Error(
        response?.error?.message || 'Failed to reply to comment'
      );
    }

    return { success: true, id: response.id };
  }

  @Tool({
    description: 'Hide or unhide a comment on an Instagram post',
    dataSchema: [
      {
        key: 'commentId',
        type: 'string',
        description: 'ID of the comment',
      },
      {
        key: 'hide',
        type: 'string',
        description: 'Set to "true" to hide, or "false" to unhide',
      },
    ],
  })
  async hideComment(token: string, data: { commentId: string; hide: string }) {
    if (!data?.commentId) {
      throw new Error('commentId is required');
    }
    const hide = String(data?.hide).toLowerCase() === 'true';
    const body = new URLSearchParams();
    body.append('hide', String(hide));

    const response = await (
      await this.fetch(
        `https://graph.instagram.com/${META_GRAPH_API_VERSION}/${encodeURIComponent(data.commentId)}`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body,
        },
        this.identifier
      )
    ).json();

    if (response?.error || response?.success === false) {
      throw new Error(
        response?.error?.message || 'Failed to update comment visibility'
      );
    }

    return {
      success: true,
      id: data.commentId,
      hidden: hide,
    };
  }

  @Tool({
    description: 'Delete a comment from an Instagram post',
    dataSchema: [
      {
        key: 'commentId',
        type: 'string',
        description: 'ID of the comment to delete',
      },
    ],
  })
  async deleteComment(token: string, data: { commentId: string }) {
    if (!data?.commentId) {
      throw new Error('commentId is required');
    }
    const response = await (
      await this.fetch(
        `https://graph.instagram.com/${META_GRAPH_API_VERSION}/${encodeURIComponent(data.commentId)}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        },
        this.identifier
      )
    ).json();

    if (response?.error || response?.success === false) {
      throw new Error(
        response?.error?.message || 'Failed to delete comment'
      );
    }

    return { success: true, id: data.commentId };
  }

  @Tool({
    description:
      'Fetch profile insights (reach, views, follower count) for the Instagram account',
    dataSchema: [
      {
        key: 'metric',
        type: 'string',
        description:
          'Comma-separated metrics, e.g. "reach,views" (defaults to "reach,views")',
      },
      {
        key: 'period',
        type: 'string',
        description:
          'Time period for metrics, e.g. "day", "week", "days_28" (defaults to "day")',
      },
    ],
  })
  async getAccountInsights(
    token: string,
    data: { metric?: string; period?: string },
    internalId?: string
  ) {
    if (!internalId) {
      throw new Error('Instagram account internalId is required');
    }
    const metric = encodeURIComponent(data?.metric || 'reach,views');
    const period = encodeURIComponent(data?.period || 'day');
    const response = await (
      await this.fetch(
        `https://graph.instagram.com/${META_GRAPH_API_VERSION}/${encodeURIComponent(internalId)}/insights?metric=${metric}&period=${period}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
        this.identifier
      )
    ).json();

    return response?.data || [];
  }

  @Tool({
    description:
      'Fetch engagement and reach metrics (views, reach, saved, likes, comments, shares) for a specific Instagram post',
    dataSchema: [
      {
        key: 'postId',
        type: 'string',
        description: 'ID of the Instagram post',
      },
    ],
  })
  async getMediaInsights(token: string, data: { postId: string }) {
    if (!data?.postId) {
      throw new Error('postId is required');
    }
    const response = await (
      await this.fetch(
        `https://graph.instagram.com/${META_GRAPH_API_VERSION}/${encodeURIComponent(data.postId)}/insights?metric=views,reach,saved,likes,comments,shares`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
        this.identifier
      )
    ).json();

    return response?.data || [];
  }
}
