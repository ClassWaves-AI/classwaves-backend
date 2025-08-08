import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import dotenv from 'dotenv';

dotenv.config();

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      callbackURL: process.env.GOOGLE_REDIRECT_URI!,
      scope: ['email', 'profile', 'openid'],
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        // Extract user data from Google profile
        const googleUser = {
          id: profile.id,
          email: profile.emails?.[0]?.value || '',
          verified_email: profile.emails?.[0]?.verified || false,
          name: profile.displayName,
          given_name: profile.name?.givenName || '',
          family_name: profile.name?.familyName || '',
          picture: profile.photos?.[0]?.value || '',
          locale: profile._json.locale || 'en',
          hd: profile._json.hd, // Google Workspace domain
        };

        return done(null, googleUser);
      } catch (error) {
        return done(error as Error, false);
      }
    }
  )
);

export default passport;