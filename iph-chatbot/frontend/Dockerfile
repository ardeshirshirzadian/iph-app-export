FROM node:22-slim
WORKDIR /app

# ۱. کپی کردن تمام فایل‌ها و پکیج‌ها
COPY . .

# ۲. بیلد کردن پروژه
ENV NODE_ENV=production
RUN npm run build

# ⚡️ خط جدید و حیاتی: دستور روشن کردن سرور پروداکشن Next.js و گوش دادن به پورت ۳۰۰۰
EXPOSE 3000
CMD ["npm", "start"]
