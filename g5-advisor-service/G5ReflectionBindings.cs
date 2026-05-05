using System.Reflection;

internal sealed class G5ReflectionBindings
{
    public Type OpponentModelingOptionsType { get; }
    public Type OpponentModelingType { get; }
    public Type ModelingEstimatorType { get; }
    public Type IActionEstimatorType { get; }
    public Type BotGameStateType { get; }
    public Type CardType { get; }
    public Type PlayerType { get; }
    public Type TableTypeType { get; }
    public Type PokerClientType { get; }
    public Type ActionTypeType { get; }

    public ConstructorInfo OpponentModelingOptionsConstructor { get; }
    public ConstructorInfo OpponentModelingConstructor { get; }
    public ConstructorInfo ModelingEstimatorConstructor { get; }
    public ConstructorInfo BotGameStateConstructor { get; }
    public ConstructorInfo CardStringConstructor { get; }

    public FieldInfo RecentHandsCountField { get; }

    public MethodInfo StartNewHandMethod { get; }
    public MethodInfo DealHoleCardsMethod { get; }
    public MethodInfo GoToNextStreetCardMethod { get; }
    public MethodInfo GoToNextStreetCardsMethod { get; }
    public MethodInfo PlayerCheckCallsMethod { get; }
    public MethodInfo PlayerBetRaisesByMethod { get; }
    public MethodInfo PlayerFoldsMethod { get; }
    public MethodInfo CalculateHeroActionMethod { get; }
    public MethodInfo GetPlayerToActIndMethod { get; }
    public MethodInfo GetStreetMethod { get; }
    public MethodInfo PotSizeMethod { get; }
    public MethodInfo GetAmountToCallMethod { get; }
    public MethodInfo GetPlayersMethod { get; }
    public MethodInfo NumActivePlayersMethod { get; }
    public MethodInfo NumActiveNonAllInPlayersMethod { get; }

    public BoundMember DecisionActionTypeMember { get; }
    public BoundMember DecisionByAmountMember { get; }
    public BoundMember DecisionCheckCallEvMember { get; }
    public BoundMember DecisionBetRaiseEvMember { get; }
    public BoundMember DecisionTimeSpentSecondsMember { get; }
    public BoundMember DecisionMessageMember { get; }
    public BoundMember PlayerStackMember { get; }
    public BoundMember PlayerMoneyInPotMember { get; }

    public object TableTypeHeadsUpValue { get; }
    public object TableTypeSixMaxValue { get; }
    public object PokerClientPokerKingValue { get; }
    public object ActionTypeNoActionValue { get; }

    public IReadOnlyList<string> BindingDump { get; }

    private G5ReflectionBindings(
        Type opponentModelingOptionsType,
        Type opponentModelingType,
        Type modelingEstimatorType,
        Type iActionEstimatorType,
        Type botGameStateType,
        Type cardType,
        Type playerType,
        Type tableTypeType,
        Type pokerClientType,
        Type actionTypeType,
        ConstructorInfo opponentModelingOptionsConstructor,
        ConstructorInfo opponentModelingConstructor,
        ConstructorInfo modelingEstimatorConstructor,
        ConstructorInfo botGameStateConstructor,
        ConstructorInfo cardStringConstructor,
        FieldInfo recentHandsCountField,
        MethodInfo startNewHandMethod,
        MethodInfo dealHoleCardsMethod,
        MethodInfo goToNextStreetCardMethod,
        MethodInfo goToNextStreetCardsMethod,
        MethodInfo playerCheckCallsMethod,
        MethodInfo playerBetRaisesByMethod,
        MethodInfo playerFoldsMethod,
        MethodInfo calculateHeroActionMethod,
        MethodInfo getPlayerToActIndMethod,
        MethodInfo getStreetMethod,
        MethodInfo potSizeMethod,
        MethodInfo getAmountToCallMethod,
        MethodInfo getPlayersMethod,
        MethodInfo numActivePlayersMethod,
        MethodInfo numActiveNonAllInPlayersMethod,
        BoundMember decisionActionTypeMember,
        BoundMember decisionByAmountMember,
        BoundMember decisionCheckCallEvMember,
        BoundMember decisionBetRaiseEvMember,
        BoundMember decisionTimeSpentSecondsMember,
        BoundMember decisionMessageMember,
        BoundMember playerStackMember,
        BoundMember playerMoneyInPotMember,
        object tableTypeHeadsUpValue,
        object tableTypeSixMaxValue,
        object pokerClientPokerKingValue,
        object actionTypeNoActionValue,
        IReadOnlyList<string> bindingDump)
    {
        OpponentModelingOptionsType = opponentModelingOptionsType;
        OpponentModelingType = opponentModelingType;
        ModelingEstimatorType = modelingEstimatorType;
        IActionEstimatorType = iActionEstimatorType;
        BotGameStateType = botGameStateType;
        CardType = cardType;
        PlayerType = playerType;
        TableTypeType = tableTypeType;
        PokerClientType = pokerClientType;
        ActionTypeType = actionTypeType;
        OpponentModelingOptionsConstructor = opponentModelingOptionsConstructor;
        OpponentModelingConstructor = opponentModelingConstructor;
        ModelingEstimatorConstructor = modelingEstimatorConstructor;
        BotGameStateConstructor = botGameStateConstructor;
        CardStringConstructor = cardStringConstructor;
        RecentHandsCountField = recentHandsCountField;
        StartNewHandMethod = startNewHandMethod;
        DealHoleCardsMethod = dealHoleCardsMethod;
        GoToNextStreetCardMethod = goToNextStreetCardMethod;
        GoToNextStreetCardsMethod = goToNextStreetCardsMethod;
        PlayerCheckCallsMethod = playerCheckCallsMethod;
        PlayerBetRaisesByMethod = playerBetRaisesByMethod;
        PlayerFoldsMethod = playerFoldsMethod;
        CalculateHeroActionMethod = calculateHeroActionMethod;
        GetPlayerToActIndMethod = getPlayerToActIndMethod;
        GetStreetMethod = getStreetMethod;
        PotSizeMethod = potSizeMethod;
        GetAmountToCallMethod = getAmountToCallMethod;
        GetPlayersMethod = getPlayersMethod;
        NumActivePlayersMethod = numActivePlayersMethod;
        NumActiveNonAllInPlayersMethod = numActiveNonAllInPlayersMethod;
        DecisionActionTypeMember = decisionActionTypeMember;
        DecisionByAmountMember = decisionByAmountMember;
        DecisionCheckCallEvMember = decisionCheckCallEvMember;
        DecisionBetRaiseEvMember = decisionBetRaiseEvMember;
        DecisionTimeSpentSecondsMember = decisionTimeSpentSecondsMember;
        DecisionMessageMember = decisionMessageMember;
        PlayerStackMember = playerStackMember;
        PlayerMoneyInPotMember = playerMoneyInPotMember;
        TableTypeHeadsUpValue = tableTypeHeadsUpValue;
        TableTypeSixMaxValue = tableTypeSixMaxValue;
        PokerClientPokerKingValue = pokerClientPokerKingValue;
        ActionTypeNoActionValue = actionTypeNoActionValue;
        BindingDump = bindingDump;
    }

    public static G5ReflectionBindings Create(Assembly logicAssembly)
    {
        var opponentModelingOptionsType = GetTypeOrThrow(logicAssembly, "G5.Logic.OpponentModeling+Options");
        var opponentModelingType = GetTypeOrThrow(logicAssembly, "G5.Logic.OpponentModeling");
        var modelingEstimatorType = GetTypeOrThrow(logicAssembly, "G5.Logic.Estimators.ModelingEstimator");
        var iActionEstimatorType = GetTypeOrThrow(logicAssembly, "G5.Logic.Estimators.IActionEstimator");
        var botGameStateType = GetTypeOrThrow(logicAssembly, "G5.Logic.BotGameState");
        var cardType = GetTypeOrThrow(logicAssembly, "G5.Logic.Card");
        var playerType = GetTypeOrThrow(logicAssembly, "G5.Logic.Player");
        var tableTypeType = GetTypeOrThrow(logicAssembly, "G5.Logic.TableType");
        var pokerClientType = GetTypeOrThrow(logicAssembly, "G5.Logic.PokerClient");
        var actionTypeType = GetTypeOrThrow(logicAssembly, "G5.Logic.ActionType");

        var opponentModelingOptionsConstructor = GetConstructorOrThrow(opponentModelingOptionsType, Type.EmptyTypes);
        var recentHandsCountField = GetFieldOrThrow(opponentModelingOptionsType, "recentHandsCount");
        var opponentModelingConstructor = GetConstructorOrThrow(opponentModelingType, typeof(string), tableTypeType, opponentModelingOptionsType);
        var modelingEstimatorConstructor = GetConstructorOrThrow(modelingEstimatorType, opponentModelingType, pokerClientType);
        var botGameStateConstructor = GetConstructorOrThrow(
            botGameStateType,
            typeof(string[]),
            typeof(int[]),
            typeof(int),
            typeof(int),
            typeof(int),
            pokerClientType,
            tableTypeType,
            iActionEstimatorType,
            typeof(bool),
            typeof(int));
        var cardStringConstructor = GetConstructorOrThrow(cardType, typeof(string));

        var startNewHandMethod = GetMethodOrThrow(botGameStateType, "startNewHand", typeof(List<int>));
        var dealHoleCardsMethod = GetMethodOrThrow(botGameStateType, "dealHoleCards", cardType, cardType);
        var goToNextStreetCardMethod = GetMethodOrThrow(botGameStateType, "goToNextStreet", cardType);
        var goToNextStreetCardsMethod = GetMethodOrThrow(botGameStateType, "goToNextStreet", typeof(List<>).MakeGenericType(cardType));
        var playerCheckCallsMethod = GetMethodOrThrow(botGameStateType, "playerCheckCalls", Type.EmptyTypes);
        var playerBetRaisesByMethod = GetMethodOrThrow(botGameStateType, "playerBetRaisesBy", typeof(int));
        var playerFoldsMethod = GetMethodOrThrow(botGameStateType, "playerFolds", Type.EmptyTypes);
        var calculateHeroActionMethod = GetMethodOrThrow(botGameStateType, "calculateHeroAction", Type.EmptyTypes);
        var getPlayerToActIndMethod = GetMethodOrThrow(botGameStateType, "getPlayerToActInd", Type.EmptyTypes);
        var getStreetMethod = GetMethodOrThrow(botGameStateType, "getStreet", Type.EmptyTypes);
        var potSizeMethod = GetMethodOrThrow(botGameStateType, "potSize", Type.EmptyTypes);
        var getAmountToCallMethod = GetMethodOrThrow(botGameStateType, "getAmountToCall", Type.EmptyTypes);
        var getPlayersMethod = GetMethodOrThrow(botGameStateType, "getPlayers", Type.EmptyTypes);
        var numActivePlayersMethod = GetMethodOrThrow(botGameStateType, "numActivePlayers", Type.EmptyTypes);
        var numActiveNonAllInPlayersMethod = GetMethodOrThrow(botGameStateType, "numActiveNonAllInPlayers", Type.EmptyTypes);

        var decisionType = calculateHeroActionMethod.ReturnType;
        var decisionActionTypeMember = CreateBoundMember(decisionType, "actionType");
        var decisionByAmountMember = CreateBoundMember(decisionType, "byAmount");
        var decisionCheckCallEvMember = CreateBoundMember(decisionType, "checkCallEV");
        var decisionBetRaiseEvMember = CreateBoundMember(decisionType, "betRaiseEV");
        var decisionTimeSpentSecondsMember = CreateBoundMember(decisionType, "timeSpentSeconds");
        var decisionMessageMember = CreateBoundMember(decisionType, "message");
        var playerStackMember = CreateBoundMember(playerType, "Stack");
        var playerMoneyInPotMember = CreateBoundMember(playerType, "MoneyInPot");

        var tableTypeHeadsUpValue = GetEnumValueOrThrow(tableTypeType, "HeadsUp");
        var tableTypeSixMaxValue = GetEnumValueOrThrow(tableTypeType, "SixMax");
        var pokerClientPokerKingValue = GetEnumValueOrThrow(pokerClientType, "PokerKing");
        var actionTypeNoActionValue = GetEnumValueOrThrow(actionTypeType, "NoAction");

        var dump = new List<string>
        {
            $"Type {opponentModelingOptionsType.FullName}",
            $"Type {opponentModelingType.FullName}",
            $"Type {modelingEstimatorType.FullName}",
            $"Type {botGameStateType.FullName}",
            $"Type {cardType.FullName}",
            $"Type {playerType.FullName}",
            $"Ctor {FormatSignature(opponentModelingOptionsConstructor)}",
            $"Field {recentHandsCountField.FieldType.Name} {opponentModelingOptionsType.FullName}.{recentHandsCountField.Name}",
            $"Ctor {FormatSignature(opponentModelingConstructor)}",
            $"Ctor {FormatSignature(modelingEstimatorConstructor)}",
            $"Ctor {FormatSignature(botGameStateConstructor)}",
            $"Ctor {FormatSignature(cardStringConstructor)}",
            $"Method {FormatSignature(startNewHandMethod)}",
            $"Method {FormatSignature(dealHoleCardsMethod)}",
            $"Method {FormatSignature(goToNextStreetCardMethod)}",
            $"Method {FormatSignature(goToNextStreetCardsMethod)}",
            $"Method {FormatSignature(playerCheckCallsMethod)}",
            $"Method {FormatSignature(playerBetRaisesByMethod)}",
            $"Method {FormatSignature(playerFoldsMethod)}",
            $"Method {FormatSignature(calculateHeroActionMethod)}",
            $"Method {FormatSignature(getPlayerToActIndMethod)}",
            $"Method {FormatSignature(getStreetMethod)}",
            $"Method {FormatSignature(potSizeMethod)}",
            $"Method {FormatSignature(getAmountToCallMethod)}",
            $"Method {FormatSignature(getPlayersMethod)}",
            $"Method {FormatSignature(numActivePlayersMethod)}",
            $"Method {FormatSignature(numActiveNonAllInPlayersMethod)}",
            $"Member {decisionActionTypeMember.Signature}",
            $"Member {decisionByAmountMember.Signature}",
            $"Member {decisionCheckCallEvMember.Signature}",
            $"Member {decisionBetRaiseEvMember.Signature}",
            $"Member {decisionTimeSpentSecondsMember.Signature}",
            $"Member {decisionMessageMember.Signature}",
            $"Member {playerStackMember.Signature}",
            $"Member {playerMoneyInPotMember.Signature}",
            $"Enum {tableTypeType.FullName}.HeadsUp={(int)tableTypeHeadsUpValue}",
            $"Enum {tableTypeType.FullName}.SixMax={(int)tableTypeSixMaxValue}",
            $"Enum {pokerClientType.FullName}.PokerKing={(int)pokerClientPokerKingValue}",
            $"Enum {actionTypeType.FullName}.NoAction={(int)actionTypeNoActionValue}",
        };

        return new G5ReflectionBindings(
            opponentModelingOptionsType,
            opponentModelingType,
            modelingEstimatorType,
            iActionEstimatorType,
            botGameStateType,
            cardType,
            playerType,
            tableTypeType,
            pokerClientType,
            actionTypeType,
            opponentModelingOptionsConstructor,
            opponentModelingConstructor,
            modelingEstimatorConstructor,
            botGameStateConstructor,
            cardStringConstructor,
            recentHandsCountField,
            startNewHandMethod,
            dealHoleCardsMethod,
            goToNextStreetCardMethod,
            goToNextStreetCardsMethod,
            playerCheckCallsMethod,
            playerBetRaisesByMethod,
            playerFoldsMethod,
            calculateHeroActionMethod,
            getPlayerToActIndMethod,
            getStreetMethod,
            potSizeMethod,
            getAmountToCallMethod,
            getPlayersMethod,
            numActivePlayersMethod,
            numActiveNonAllInPlayersMethod,
            decisionActionTypeMember,
            decisionByAmountMember,
            decisionCheckCallEvMember,
            decisionBetRaiseEvMember,
            decisionTimeSpentSecondsMember,
            decisionMessageMember,
            playerStackMember,
            playerMoneyInPotMember,
            tableTypeHeadsUpValue,
            tableTypeSixMaxValue,
            pokerClientPokerKingValue,
            actionTypeNoActionValue,
            dump);
    }

    private static Type GetTypeOrThrow(Assembly assembly, string fullName)
    {
        return assembly.GetType(fullName, throwOnError: false)
            ?? throw new InvalidOperationException($"Failed to bind reflected type {fullName}");
    }

    private static ConstructorInfo GetConstructorOrThrow(Type type, params Type[] parameterTypes)
    {
        var constructor = type.GetConstructor(parameterTypes);
        if (constructor is not null)
        {
            return constructor;
        }

        var overloads = type.GetConstructors(BindingFlags.Public | BindingFlags.Instance)
            .Select(FormatSignature)
            .ToArray();
        throw new InvalidOperationException(
            $"Failed to bind constructor on {type.FullName} with parameters ({FormatParameterTypes(parameterTypes)}). Available: {string.Join("; ", overloads)}");
    }

    private static MethodInfo GetMethodOrThrow(Type type, string methodName, params Type[] parameterTypes)
    {
        var methods = type.GetMethods(BindingFlags.Public | BindingFlags.Instance)
            .Where(method => method.Name == methodName)
            .ToArray();

        foreach (var method in methods)
        {
            var parameters = method.GetParameters();
            if (parameters.Length != parameterTypes.Length)
            {
                continue;
            }

            var allMatch = true;
            for (var index = 0; index < parameters.Length; index += 1)
            {
                if (parameters[index].ParameterType != parameterTypes[index])
                {
                    allMatch = false;
                    break;
                }
            }

            if (allMatch)
            {
                return method;
            }
        }

        var overloads = methods.Select(FormatSignature).ToArray();
        throw new InvalidOperationException(
            $"Failed to bind method {type.FullName}.{methodName} with parameters ({FormatParameterTypes(parameterTypes)}). Available: {string.Join("; ", overloads)}");
    }

    private static FieldInfo GetFieldOrThrow(Type type, string fieldName)
    {
        return type.GetField(fieldName, BindingFlags.Public | BindingFlags.Instance)
            ?? throw new InvalidOperationException($"Failed to bind field {type.FullName}.{fieldName}");
    }

    private static BoundMember CreateBoundMember(Type type, string memberName)
    {
        var field = type.GetField(memberName, BindingFlags.Public | BindingFlags.Instance);
        if (field is not null)
        {
            return new BoundMember(
                memberName,
                $"{field.FieldType.Name} {type.FullName}.{field.Name}",
                instance => field.GetValue(instance));
        }

        var property = type.GetProperty(memberName, BindingFlags.Public | BindingFlags.Instance);
        if (property is not null)
        {
            return new BoundMember(
                memberName,
                $"{property.PropertyType.Name} {type.FullName}.{property.Name}",
                instance => property.GetValue(instance));
        }

        throw new InvalidOperationException($"Failed to bind member {type.FullName}.{memberName}");
    }

    private static object GetEnumValueOrThrow(Type enumType, string name)
    {
        return Enum.Parse(enumType, name, ignoreCase: false);
    }

    private static string FormatSignature(MethodBase methodBase)
    {
        var parameters = string.Join(", ", methodBase.GetParameters().Select(parameter => $"{FormatTypeName(parameter.ParameterType)} {parameter.Name}"));

        return methodBase switch
        {
            MethodInfo method => $"{FormatTypeName(method.ReturnType)} {method.Name}({parameters})",
            ConstructorInfo constructor => $"{constructor.DeclaringType?.Name}({parameters})",
            _ => methodBase.ToString() ?? "<unknown signature>",
        };
    }

    private static string FormatParameterTypes(IEnumerable<Type> parameterTypes)
    {
        return string.Join(", ", parameterTypes.Select(FormatTypeName));
    }

    private static string FormatTypeName(Type type)
    {
        if (type.IsArray)
        {
            return $"{FormatTypeName(type.GetElementType() ?? typeof(object))}[]";
        }

        if (type.IsGenericType)
        {
            var genericName = type.Name[..type.Name.IndexOf('`')];
            var arguments = string.Join(", ", type.GetGenericArguments().Select(FormatTypeName));
            return $"{genericName}<{arguments}>";
        }

        return type.Name;
    }
}

internal sealed record BoundMember(string Name, string Signature, Func<object, object?> Read);
