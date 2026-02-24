import { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { query } from './db';

interface UserRow {
  id:            number;
  username:      string;
  password_hash: string;
  role:          string;
}

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,
  session: { strategy: 'jwt', maxAge: 8 * 60 * 60 },

  pages: {
    signIn: '/login',
    error:  '/login',
  },

  providers: [
    CredentialsProvider({
      name: 'Ghost Credentials',
      credentials: {
        username: { label: 'Username', type: 'text'     },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.username || !credentials?.password) return null;

        const rows = await query<UserRow>(
          'SELECT id, username, password_hash, role FROM users WHERE username = $1 LIMIT 1',
          [credentials.username],
        );

        const user = rows[0];
        if (!user) return null;

        const valid = await bcrypt.compare(credentials.password, user.password_hash);
        if (!valid) return null;

        return {
          id:    String(user.id),
          name:  user.username,
          email: `${user.username}@ghost.local`,
          role:  user.role,
        };
      },
    }),
  ],

  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id   = user.id;
        token.role = (user as any).role;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id   = token.id;
        (session.user as any).role = token.role;
      }
      return session;
    },
  },
};
