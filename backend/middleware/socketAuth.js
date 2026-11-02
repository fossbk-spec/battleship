import { verifyToken, supabase } from '../config/supabase.js';

/**
 * Socket.IO middleware to authenticate connections
 * Verifies JWT token from handshake auth or Authorization header
 */
export const socketAuthMiddleware = async (socket, next) => {
  try {
    // Try to get token from different sources
    let token = null;

    // 1. From auth object (socket.io-client sends it here)
    if (socket.handshake.auth && socket.handshake.auth.token) {
      token = socket.handshake.auth.token;
    }
    // 2. From headers
    else if (socket.handshake.headers?.authorization) {
      const authHeader = socket.handshake.headers.authorization;
      if (authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
      }
    }

    if (!token) {
      return next(new Error('Authentication error: No token provided'));
    }

    // Verify the token
    const user = await verifyToken(token);

    if (!user) {
      return next(new Error('Authentication error: Invalid token'));
    }

    // Fetch user profile to get username
    const { data: profile } = await supabase
      .from('profiles')
      .select('username')
      .eq('user_id', user.id)
      .single();

    // Attach user to socket for use in event handlers
    socket.userId = user.id;
    socket.userEmail = user.email;
    socket.username = profile?.username || user.email?.split('@')[0] || 'Player';
    socket.user = user;

    console.log(`✅ Socket authenticated: ${user.id} (${socket.username})`);

    next();
  } catch (error) {
    console.error('Socket auth error:', error);
    next(new Error('Authentication error: Failed to authenticate'));
  }
};

export default socketAuthMiddleware;
