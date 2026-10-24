import { UserStatus } from "../generated/prisma/enums";

export interface AuthenticatedUser {
  id: string;
  email: string;
  displayName: string | null;
  status: UserStatus;
}

export interface UserResponse {
  id: string;
  email: string;
  displayName: string | null;
  status: UserStatus;
  createdAt: string;
  emailVerifiedAt?: string | null;
  lastLoginAt?: string | null;
}

export interface AuthSessionResponse {
  token: string;
  accessToken: string;
  refreshToken?: string;
  user: UserResponse;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}
