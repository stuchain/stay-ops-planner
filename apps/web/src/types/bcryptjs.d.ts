declare module "bcryptjs" {
  const bcrypt: {
    compare(plainText: string, passwordHash: string): Promise<boolean>;
  };
  export default bcrypt;
}

