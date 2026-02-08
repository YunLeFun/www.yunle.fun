#!/bin/bash

# GitHub OAuth 登录测试准备检查脚本
# 用于验证所有配置是否正确

set -e

echo "🧪 GitHub OAuth 登录流程 - 配置检查"
echo "========================================"
echo ""

# 颜色定义
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 检查函数
check_pass() {
    echo -e "${GREEN}✅ $1${NC}"
}

check_fail() {
    echo -e "${RED}❌ $1${NC}"
}

check_warn() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

# 计数器
PASS=0
FAIL=0
WARN=0

echo "📋 1. 检查后端 API 配置"
echo "----------------------------------------"

API_DIR="../../api"
if [ -d "$API_DIR" ]; then
    check_pass "后端目录存在: $API_DIR"
    ((PASS++))
    
    if [ -f "$API_DIR/.env" ]; then
        check_pass "后端 .env 文件存在"
        ((PASS++))
        
        # 检查必需的环境变量
        cd "$API_DIR"
        
        if grep -q "GITHUB_CLIENT_ID=" .env && [ -n "$(grep GITHUB_CLIENT_ID= .env | cut -d'=' -f2)" ]; then
            check_pass "GITHUB_CLIENT_ID 已配置"
            ((PASS++))
        else
            check_fail "GITHUB_CLIENT_ID 未配置"
            ((FAIL++))
        fi
        
        if grep -q "GITHUB_CLIENT_SECRET=" .env && [ -n "$(grep GITHUB_CLIENT_SECRET= .env | cut -d'=' -f2)" ]; then
            check_pass "GITHUB_CLIENT_SECRET 已配置"
            ((PASS++))
        else
            check_fail "GITHUB_CLIENT_SECRET 未配置"
            ((FAIL++))
        fi
        
        if grep -q "GITHUB_CALLBACK_URL=" .env; then
            CALLBACK_URL=$(grep GITHUB_CALLBACK_URL= .env | cut -d'=' -f2)
            if [[ "$CALLBACK_URL" == *"localhost:3000/auth/github/callback"* ]]; then
                check_pass "GITHUB_CALLBACK_URL 配置正确: $CALLBACK_URL"
                ((PASS++))
            else
                check_warn "GITHUB_CALLBACK_URL 可能不正确: $CALLBACK_URL"
                ((WARN++))
            fi
        else
            check_fail "GITHUB_CALLBACK_URL 未配置"
            ((FAIL++))
        fi
        
        if grep -q "GITHUB_LOGIN_REDIRECT_URL=" .env; then
            REDIRECT_URL=$(grep GITHUB_LOGIN_REDIRECT_URL= .env | cut -d'=' -f2)
            if [[ "$REDIRECT_URL" == *"localhost:5173/auth/github-callback"* ]]; then
                check_pass "GITHUB_LOGIN_REDIRECT_URL 配置正确: $REDIRECT_URL"
                ((PASS++))
            else
                check_warn "GITHUB_LOGIN_REDIRECT_URL 可能不正确: $REDIRECT_URL"
                ((WARN++))
            fi
        else
            check_fail "GITHUB_LOGIN_REDIRECT_URL 未配置"
            ((FAIL++))
        fi
        
        if grep -q "SESSION_SECRET=" .env && [ -n "$(grep SESSION_SECRET= .env | cut -d'=' -f2)" ]; then
            check_pass "SESSION_SECRET 已配置"
            ((PASS++))
        else
            check_fail "SESSION_SECRET 未配置"
            ((FAIL++))
        fi
        
        cd - > /dev/null
    else
        check_fail "后端 .env 文件不存在"
        ((FAIL++))
    fi
else
    check_fail "后端目录不存在: $API_DIR"
    ((FAIL++))
fi

echo ""
echo "📋 2. 检查前端网站配置"
echo "----------------------------------------"

if [ -f "../.env" ]; then
    check_pass "前端 .env 文件存在"
    ((PASS++))
    
    if grep -q "NUXT_PUBLIC_API_BASE_URL=" ../.env; then
        API_URL=$(grep NUXT_PUBLIC_API_BASE_URL= ../.env | cut -d'=' -f2)
        if [[ "$API_URL" == *"localhost:3000"* ]]; then
            check_pass "NUXT_PUBLIC_API_BASE_URL 配置正确: $API_URL"
            ((PASS++))
        else
            check_warn "NUXT_PUBLIC_API_BASE_URL 可能不正确: $API_URL"
            ((WARN++))
        fi
    else
        check_fail "NUXT_PUBLIC_API_BASE_URL 未配置"
        ((FAIL++))
    fi
else
    check_warn "前端 .env 文件不存在（将使用默认值）"
    ((WARN++))
fi

echo ""
echo "📋 3. 检查必需文件"
echo "----------------------------------------"

# 检查前端关键文件
FILES=(
    "../app/composables/useAuth.ts"
    "../app/pages/login.vue"
    "../app/pages/auth/github-callback.vue"
    "../app/components/LanguageSwitcher.vue"
    "../app/locales/zh-CN.json"
    "../app/locales/en.json"
)

for file in "${FILES[@]}"; do
    if [ -f "$file" ]; then
        check_pass "文件存在: $file"
        ((PASS++))
    else
        check_fail "文件缺失: $file"
        ((FAIL++))
    fi
done

echo ""
echo "📋 4. 检查后端关键文件"
echo "----------------------------------------"

if [ -d "$API_DIR" ]; then
    cd "$API_DIR"
    
    BACKEND_FILES=(
        "src/auth/auth.controller.ts"
        "src/auth/auth.service.ts"
        "src/auth/strategy/github.strategy.ts"
        "src/users/users.service.ts"
        "prisma/schema.prisma"
    )
    
    for file in "${BACKEND_FILES[@]}"; do
        if [ -f "$file" ]; then
            check_pass "文件存在: $file"
            ((PASS++))
        else
            check_fail "文件缺失: $file"
            ((FAIL++))
        fi
    done
    
    cd - > /dev/null
fi

echo ""
echo "📋 5. 检查数据库表"
echo "----------------------------------------"

if [ -d "$API_DIR" ] && [ -f "$API_DIR/prisma/schema.prisma" ]; then
    cd "$API_DIR"
    
    if grep -q "model UserOAuthAccount" prisma/schema.prisma; then
        check_pass "UserOAuthAccount 模型已定义"
        ((PASS++))
    else
        check_fail "UserOAuthAccount 模型未定义"
        ((FAIL++))
    fi
    
    cd - > /dev/null
fi

echo ""
echo "📊 测试结果汇总"
echo "========================================"
echo -e "${GREEN}✅ 通过: $PASS${NC}"
echo -e "${YELLOW}⚠️  警告: $WARN${NC}"
echo -e "${RED}❌ 失败: $FAIL${NC}"
echo ""

if [ $FAIL -eq 0 ]; then
    echo -e "${GREEN}🎉 所有检查通过！可以开始测试登录流程${NC}"
    echo ""
    echo "📝 下一步操作："
    echo "1. 启动后端 API:    cd ../../api && pnpm dev"
    echo "2. 启动前端网站:    cd .. && pnpm dev"
    echo "3. 访问登录页面:    http://localhost:5173/login"
    echo "4. 点击 GitHub 登录按钮"
    echo ""
    exit 0
else
    echo -e "${RED}⚠️  存在 $FAIL 个配置问题，请先修复${NC}"
    echo ""
    echo "💡 修复建议："
    echo "1. 检查后端 .env 文件中的 GitHub OAuth 配置"
    echo "2. 确保 GitHub OAuth App 已正确创建"
    echo "3. 运行数据库迁移: cd ../../api && npx prisma migrate dev"
    echo ""
    exit 1
fi
