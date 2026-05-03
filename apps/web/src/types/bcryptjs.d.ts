declare module "bcryptjs" {
  const bcrypt: {
    hash(data: string, saltOrRounds: number | string): Promise<string>;
    compare(plainText: string, passwordHash: string): Promise<boolean>;
  };
  export default bcrypt;
}

