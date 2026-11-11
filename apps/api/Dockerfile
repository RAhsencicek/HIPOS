FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

# Migration konteynerinin repo-yerel dotnet-ef aracını kullanabilmesi için
# araç manifestini build aşamasına dahil et.
COPY .config/dotnet-tools.json /src/.config/dotnet-tools.json
RUN dotnet tool restore

# Proje dosyasındaki ../../../contracts göreli yolu konteynerde /contracts'e çözülür.
COPY contracts/ /contracts/

# Proje dosyasını kopyala ve bağımlılıkları indir
COPY apps/api/Hipos.Api/Hipos.Api.csproj ./Hipos.Api/
WORKDIR /src/Hipos.Api
RUN dotnet restore

# Tüm kaynak kodunu kopyala ve derle
WORKDIR /src
COPY apps/api/Hipos.Api/ ./Hipos.Api/
WORKDIR /src/Hipos.Api
RUN dotnet publish Hipos.Api.csproj -c Release -o /app --no-restore

# Çalışma aşaması — sadece derlenmiş dosyalar
FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /app .

# Render ücretsiz planda port 10000 kullanır
ENV ASPNETCORE_URLS=http://+:10000
ENV ASPNETCORE_ENVIRONMENT=Production
EXPOSE 10000

ENTRYPOINT ["dotnet", "Hipos.Api.dll"]
